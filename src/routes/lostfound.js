const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadLostFound } = require('../middleware/upload');
const { rankLostFoundCandidates } = require('../services/lostFoundMatcher');
const { notifyAdmins, notifyUsers, safeNotify } = require('../services/notifications');

const AUTO_MATCH_THRESHOLD = 0.78;
const VALID_STATUSES = ['open', 'matched', 'claimed', 'resolved', 'closed'];

function parseImageFingerprints(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function itemLabel(item) {
  return item?.item_name || 'your item';
}

function isStrongAutoMatch(best) {
  if (!best || typeof best.match_score_raw !== 'number') return false;
  if (best.match_score_raw < AUTO_MATCH_THRESHOLD) return false;

  const imageReady = best.image_analysis_used && typeof best.image_match_score === 'number';
  const structuredReady = typeof best.structured_score === 'number';
  const visionReady = typeof best.vision_score === 'number';
  const keywordSupport = Array.isArray(best.common_keywords) ? best.common_keywords.length : 0;

  if (imageReady && best.image_match_score >= 0.75 && best.match_score_raw >= 0.74) {
    return true;
  }
  if (structuredReady && visionReady && best.structured_score >= 0.8 && best.vision_score >= 0.7) {
    return true;
  }
  if (!imageReady && structuredReady && best.structured_score >= 0.88 && keywordSupport >= 2) {
    return true;
  }
  return false;
}

async function fetchLostFoundItemWithImages(client, id) {
  const result = await client.query(
    `SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
      COALESCE(
        json_agg(json_build_object('id', lfi.id, 'image_url', lfi.image_url) ORDER BY lfi.display_order) FILTER (WHERE lfi.id IS NOT NULL),
        '[]'
      ) as images
     FROM lost_found lf
     LEFT JOIN users u ON lf.reporter_id = u.id
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.id = $1
     GROUP BY lf.id, u.first_name, u.last_name`,
    [id]
  );
  return result.rows[0] || null;
}

async function fetchLostFoundCandidates(client, target) {
  const oppositeType = target.type === 'lost' ? 'found' : 'lost';
  const result = await client.query(
    `SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
      COALESCE(
        json_agg(json_build_object('id', lfi.id, 'image_url', lfi.image_url) ORDER BY lfi.display_order) FILTER (WHERE lfi.id IS NOT NULL),
        '[]'
      ) as images
     FROM lost_found lf
     LEFT JOIN users u ON lf.reporter_id = u.id
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.type = $1
       AND lf.status = 'open'
       AND COALESCE(lf.match_review_status, 'none') NOT IN ('pending', 'approved')
       AND lf.id != $2
     GROUP BY lf.id, u.first_name, u.last_name
     ORDER BY lf.created_at DESC
     LIMIT 60`,
    [oppositeType, target.id]
  );
  return result.rows;
}

async function maybeQueueAutoMatch(client, target) {
  const candidates = await fetchLostFoundCandidates(client, target);
  if (!candidates.length) return null;

  const ranked = await rankLostFoundCandidates(target, candidates);
  const best = ranked[0];
  if (!isStrongAutoMatch(best)) return null;

  await client.query(
    `UPDATE lost_found
     SET matched_with = CASE
           WHEN id = $1 THEN $2
           WHEN id = $2 THEN $1
           ELSE matched_with
         END,
         match_review_status = 'pending',
         match_score = $3,
         updated_at = NOW()
     WHERE id IN ($1, $2)`,
    [target.id, best.id, best.match_score_raw]
  );

  return {
    matched: true,
    match_score: best.match_score_raw,
    partner_id: best.id,
    review_item_id: target.type === 'found' ? target.id : best.id,
  };
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const isStudent = req.user.role === 'student';
    const params = [];

    let query = `
      SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
        COALESCE(
          json_agg(
            json_build_object('id', lfi.id, 'image_url', lfi.image_url)
            ORDER BY lfi.display_order
          ) FILTER (WHERE lfi.id IS NOT NULL), '[]'
        ) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
      WHERE lf.status != 'closed'
    `;

    if (isStudent) {
      query += ` AND lf.type = 'lost' AND lf.status NOT IN ('resolved', 'closed')`;
    } else {
      if (type) {
        params.push(type);
        query += ` AND lf.type = $${params.length}`;
      }
      if (status) {
        params.push(status);
        query += ` AND lf.status = $${params.length}`;
      }
    }

    query += ` GROUP BY lf.id, u.first_name, u.last_name
               ORDER BY lf.created_at DESC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get lost/found error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

router.post('/', authenticateToken, requireRole('faculty', 'admin'), uploadLostFound.array('images', 5), async (req, res) => {
  const client = await pool.connect();
  let hydratedItem = null;
  let autoMatch = null;
  try {
    const { type, item_name, description, category, location_found, contact_info } = req.body;
    if (!type || !item_name || !description) {
      return res.status(400).json({ error: 'Type, item name, and description are required' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO lost_found (reporter_id, type, item_name, description, category, location_found, contact_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, type, item_name, description, category || null, location_found || null, contact_info || null]
    );

    const item = result.rows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        const imageUrl = `/uploads/lostfound/${req.files[i].filename}`;
        await client.query(
          `INSERT INTO lost_found_images (lost_found_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [item.id, imageUrl, i]
        );
      }
    }

    hydratedItem = await fetchLostFoundItemWithImages(client, item.id);
    hydratedItem.image_fingerprints = parseImageFingerprints(req.body.image_fingerprints);
    autoMatch = await maybeQueueAutoMatch(client, hydratedItem);

    await client.query('COMMIT');

    if (autoMatch?.matched) {
      await safeNotify('lost-found auto match', async () => {
        const partner = await fetchLostFoundItemWithImages(pool, autoMatch.partner_id);
        const reporterIds = [hydratedItem.reporter_id, partner?.reporter_id];

        await notifyUsers(pool, reporterIds, {
          title: 'Possible lost & found match found',
          message: `"${itemLabel(hydratedItem)}" may match another report and is waiting for office review.`,
          type: 'lostfound',
          link: 'page:lostfound',
        });

        await notifyAdmins(pool, {
          title: 'Lost & found review needed',
          message: `AI suggested a match between "${itemLabel(hydratedItem)}" and "${itemLabel(partner)}".`,
          type: 'lostfound',
          link: 'page:lostfound',
        });
      });
    }

    res.status(201).json({ message: 'Item reported', item: hydratedItem, autoMatch });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Report item error:', err);
    res.status(500).json({ error: 'Failed to report item' });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const check = await pool.query('SELECT reporter_id FROM lost_found WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query(
      'UPDATE lost_found SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ message: 'Status updated' });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

router.get('/review/pending', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, uf.first_name || ' ' || uf.last_name as reporter_name,
        COALESCE((
          SELECT json_agg(json_build_object('id', fi.id, 'image_url', fi.image_url) ORDER BY fi.display_order)
          FROM lost_found_images fi
          WHERE fi.lost_found_id = f.id
        ), '[]'::json) as images,
        json_build_object(
          'id', p.id,
          'item_name', p.item_name,
          'description', p.description,
          'category', p.category,
          'location_found', p.location_found,
          'contact_info', p.contact_info,
          'reporter_name', up.first_name || ' ' || up.last_name,
          'images', COALESCE((
            SELECT json_agg(json_build_object('id', pi.id, 'image_url', pi.image_url) ORDER BY pi.display_order)
            FROM lost_found_images pi
            WHERE pi.lost_found_id = p.id
          ), '[]'::json)
        ) as partner
      FROM lost_found f
      LEFT JOIN users uf ON uf.id = f.reporter_id
      LEFT JOIN lost_found p ON p.id = f.matched_with
      LEFT JOIN users up ON up.id = p.reporter_id
      WHERE f.type = 'found'
        AND f.match_review_status = 'pending'
        AND f.matched_with IS NOT NULL
      ORDER BY f.updated_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Pending LF review error:', err);
    res.status(500).json({ error: 'Failed to fetch pending match reviews' });
  }
});

router.patch('/review/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const client = await pool.connect();
  let reviewItems = [];
  let decision = null;
  try {
    decision = req.body?.decision;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approve or reject' });
    }

    await client.query('BEGIN');
    const reviewResult = await client.query(
      'SELECT id, matched_with, match_score FROM lost_found WHERE id = $1 AND match_review_status = $2',
      [req.params.id, 'pending']
    );
    if (!reviewResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending review not found' });
    }

    const review = reviewResult.rows[0];
    if (!review.matched_with) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Review has no linked match' });
    }

    const reviewItemsResult = await client.query(
      `SELECT id, reporter_id, item_name
       FROM lost_found
       WHERE id = ANY($1::uuid[])`,
      [[review.id, review.matched_with]]
    );
    reviewItems = reviewItemsResult.rows;

    if (decision === 'approve') {
      await client.query(
        `UPDATE lost_found
         SET status = 'matched',
             match_review_status = 'approved',
             matched_with = CASE WHEN id = $1 THEN $2 WHEN id = $2 THEN $1 ELSE matched_with END,
             match_score = COALESCE(match_score, $3),
             updated_at = NOW()
         WHERE id IN ($1, $2)`,
        [review.id, review.matched_with, review.match_score]
      );
    } else {
      await client.query(
        `UPDATE lost_found
         SET status = 'open',
             matched_with = NULL,
             match_review_status = 'rejected',
             match_score = NULL,
             updated_at = NOW()
         WHERE id IN ($1, $2)`,
        [review.id, review.matched_with]
      );
    }

    await client.query('COMMIT');

    await safeNotify('lost-found review decision', async () => {
      const anchorItem = reviewItems.find((item) => item.id === review.id) || reviewItems[0];
      await notifyUsers(
        pool,
        reviewItems.map((item) => item.reporter_id),
        {
          title: decision === 'approve' ? 'Lost & found match approved' : 'Lost & found match rejected',
          message: decision === 'approve'
            ? `A reported match involving "${itemLabel(anchorItem)}" was approved. Please coordinate with the office.`
            : `The proposed match involving "${itemLabel(anchorItem)}" was not approved after review.`,
          type: 'lostfound',
          link: 'page:lostfound',
        }
      );
    });

    res.json({ message: decision === 'approve' ? 'Match approved' : 'Match rejected' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('LF review decision error:', err);
    res.status(500).json({ error: 'Failed to update match review' });
  } finally {
    client.release();
  }
});

router.get('/:id/matches', authenticateToken, async (req, res) => {
  try {
    const target = await fetchLostFoundItemWithImages(pool, req.params.id);
    if (!target) return res.status(404).json({ error: 'Item not found' });

    const candidates = await fetchLostFoundCandidates(pool, target);
    const ranked = await rankLostFoundCandidates(target, candidates);

    res.json({
      matches: ranked.map(({ match_score_raw, ...candidate }) => candidate),
      target,
    });
  } catch (err) {
    console.error('LF match error:', err);
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { item_name, description, category, location_found, type, contact_info } = req.body;
    if (!item_name || !description || !type) {
      return res.status(400).json({ error: 'Item name, description, and type are required' });
    }

    const check = await pool.query('SELECT reporter_id FROM lost_found WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query(
      `UPDATE lost_found
       SET matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE matched_with = $1`,
      [id]
    );

    const result = await pool.query(
      `UPDATE lost_found
       SET item_name = $1,
           description = $2,
           category = $3,
           location_found = $4,
           type = $5,
           contact_info = $6,
           matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [item_name, description, category || null, location_found || null, type, contact_info || null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update lost-found error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const check = await client.query('SELECT reporter_id FROM lost_found WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE lost_found
       SET matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE matched_with = $1`,
      [id]
    );
    await client.query('DELETE FROM lost_found WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({ message: 'Item deleted' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Delete lost-found error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  } finally {
    client.release();
  }
});

module.exports = router;
