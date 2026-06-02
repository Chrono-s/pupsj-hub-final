const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const requireLostFound = requirePermission('lost_found');
const { uploadLostFound } = require('../middleware/upload');
const { rankLostFoundCandidates } = require('../services/lostFoundMatcher');
const { notifyAdmins, notifyUsers, notifyUser, safeNotify } = require('../services/notifications');

const AUTO_MATCH_THRESHOLD = 0.35;
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
  return best.match_score_raw >= AUTO_MATCH_THRESHOLD;
}

async function fetchLostFoundItemWithImages(client, id) {
  const result = await client.query(
    `SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
      COALESCE(
        json_agg(json_build_object('id', lfi.id, 'image_url', lfi.image_url) ORDER BY lfi.display_order) FILTER (WHERE lfi.id IS NOT NULL),
        '[]'::json
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
        '[]'::json
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
    // 1. Run auto-archiving query for items older than 4 years
    await pool.query(
      `UPDATE lost_found SET is_archived = true WHERE created_at < NOW() - INTERVAL '4 years' AND is_archived = false`
    ).catch(err => console.error('Lost & found auto-archive warning:', err.message));

    // Run auto-delete for soft-deleted lost/found items: 6 months
    await pool.query(
      `DELETE FROM lost_found 
       WHERE status = 'deleted' 
         AND updated_at < NOW() - INTERVAL '6 months'`
    ).catch(err => console.error('Auto-delete soft-deleted lost/found error:', err.message));

    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const isRestricted = req.user.role === 'student' || req.user.role === 'guest';
    const isFaculty = req.user.role === 'faculty';
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const params = [];

    let query = `
      SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
        COALESCE(
          json_agg(
            json_build_object('id', lfi.id, 'image_url', lfi.image_url)
            ORDER BY lfi.display_order
          ) FILTER (WHERE lfi.id IS NOT NULL), '[]'::json
        ) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
      WHERE 1=1
    `;

    if (type === 'pending-guest') {
      if (isAdmin || isFaculty) {
        query += ` AND lf.approved = false`;
      } else {
        query += ` AND lf.approved = true`;
      }
    } else {
      query += ` AND lf.approved = true`;
    }

    if (isRestricted) {
      // Students and guests can ONLY see open/unresolved LOST items that are NOT archived and NOT deleted
      query += ` AND lf.status NOT IN ('resolved', 'closed', 'deleted') AND lf.type = 'lost' AND lf.is_archived = false`;
    } else {
      // Faculty and Admins can see all item categories (lost, found, resolved, matched, claimed)
      if (status === 'archived') {
        if (isAdmin) {
          // Only Admin/Superadmin can see archived/deleted items
          query += ` AND (lf.is_archived = true OR lf.status = 'deleted')`;
        } else {
          // Faculty cannot see archived items
          query += ` AND 1=0`;
        }
      } else {
        // Normal list view: exclude archived and deleted items
        query += ` AND lf.is_archived = false AND lf.status != 'deleted'`;
        if (status) {
          if (status === 'resolved') {
            query += ` AND lf.status IN ('resolved', 'claimed') AND lf.type = 'found'`;
          } else {
            params.push(status);
            query += ` AND lf.status = $${params.length}`;
          }
        } else {
          query += ` AND lf.status != 'closed'`;
        }
      }
      if (type && type !== 'pending-guest') {
        params.push(type);
        query += ` AND lf.type = $${params.length}`;
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
router.post('/', authenticateToken, requireRole('student', 'faculty', 'admin', 'guest'), uploadLostFound.array('images', 5), async (req, res) => {
  const client = await pool.connect();
  let hydratedItem = null;
  let autoMatch = null;
  try {
    const { type, item_name, description, category, location_found, contact_info, date_lost_found } = req.body;
    if (!type || !item_name || !description || !date_lost_found || !contact_info || !contact_info.trim()) {
      return res.status(400).json({ error: 'Type, item name, description, contact information, and date lost/found are required' });
    }

    const isGuest = req.user.role === 'guest';
    const approvedVal = !isGuest;

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO lost_found (reporter_id, type, item_name, description, category, location_found, contact_info, approved, date_lost_found)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, type, item_name, description, category || null, location_found || null, contact_info || null, approvedVal, date_lost_found]
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

    const check = await pool.query('SELECT reporter_id, type FROM lost_found WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const item = check.rows[0];
    if (item.reporter_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (status === 'resolved' && item.type !== 'found') {
      return res.status(400).json({ error: 'Only found items can be marked as resolved' });
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

router.get('/matches/all', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    // 1. Fetch Existing Matches (Approved or Pending Review)
    const existingResult = await pool.query(`
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
          'reporter_name', COALESCE(up.first_name || ' ' || up.last_name, 'Unknown'),
          'images', COALESCE((
            SELECT json_agg(json_build_object('id', pi.id, 'image_url', pi.image_url) ORDER BY pi.display_order)
            FROM lost_found_images pi
            WHERE pi.lost_found_id = p.id
          ), '[]'::json),
          'match_review_status', p.match_review_status,
          'status', p.status
        ) as partner
      FROM lost_found f
      LEFT JOIN users uf ON uf.id = f.reporter_id
      JOIN lost_found p ON p.id = f.matched_with
      LEFT JOIN users up ON up.id = p.reporter_id
      WHERE f.type = 'found'
        AND f.matched_with IS NOT NULL
        AND (f.status IN ('matched', 'claimed', 'resolved') OR f.match_review_status = 'pending')
      ORDER BY f.updated_at DESC
    `);

    const matches = existingResult.rows.map(row => ({
      match_score: row.match_score ? (row.match_score > 1 ? row.match_score / 100 : row.match_score) : 0,
      lost_item: { ...row.partner, id: row.matched_with },
      found_item: { ...row, partner: undefined }
    }));

    // 2. Discover New Potential Matches among 'open' items
    const openFound = await pool.query(`
      SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
        COALESCE((
          SELECT json_agg(json_build_object('id', fi.id, 'image_url', fi.image_url) ORDER BY fi.display_order)
          FROM lost_found_images fi
          WHERE fi.lost_found_id = lf.id
        ), '[]'::json) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      WHERE lf.type = 'found' AND lf.status = 'open' AND (lf.matched_with IS NULL OR lf.match_review_status = 'rejected')
    `);

    const openLost = await pool.query(`
      SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
        COALESCE((
          SELECT json_agg(json_build_object('id', fi.id, 'image_url', fi.image_url) ORDER BY fi.display_order)
          FROM lost_found_images fi
          WHERE fi.lost_found_id = lf.id
        ), '[]'::json) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      WHERE lf.type = 'lost' AND lf.status = 'open' AND (lf.matched_with IS NULL OR lf.match_review_status = 'rejected')
    `);

    // Track which lost item IDs have already been matched (to avoid double-matching)
    const matchedLostIds = new Set(matches.map(m => String(m.lost_item?.id)).filter(Boolean));

    if (openFound.rows.length > 0 && openLost.rows.length > 0) {
      for (const fItem of openFound.rows) {
        try {
          // Filter out already-matched lost items and prevent re-matching rejected pairs
          const availableLost = openLost.rows.filter(l => {
            if (matchedLostIds.has(String(l.id))) return false;
            if (fItem.match_review_status === 'rejected' && String(l.id) === String(fItem.matched_with)) return false;
            if (l.match_review_status === 'rejected' && String(fItem.id) === String(l.matched_with)) return false;
            return true;
          });
          if (availableLost.length === 0) continue;

          const ranked = await rankLostFoundCandidates(fItem, availableLost, { minScore: 20 });
          if (ranked.length === 0) continue;

          // Only take the BEST match for each found item
          const best = ranked[0];

          // Persist the discovered match to the database so the approve route can find it
          try {
            await pool.query(
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
              [fItem.id, best.id, best.match_score_raw]
            );
          } catch (persistErr) {
            console.warn(`Failed to persist discovered match (found=${fItem.id}, lost=${best.id}):`, persistErr.message);
          }

          // Mark the lost item as taken so it won't be matched again
          matchedLostIds.add(String(best.id));

          const updatedLostItem = { ...best, match_review_status: 'pending' };
          const updatedFoundItem = { ...fItem, match_review_status: 'pending' };
          matches.push({
            match_score: best.match_score_raw,
            lost_item: updatedLostItem,
            found_item: updatedFoundItem
          });
        } catch (matchErr) {
          console.warn(`Failed to discover matches for found item ${fItem.id}:`, matchErr.message);
        }
      }
    }

    matches.sort((a, b) => b.match_score - a.match_score);
    res.json(matches);
  } catch (err) {
    console.error('All LF matches error:', err);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

router.get('/review/pending', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
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
          'reporter_name', COALESCE(up.first_name || ' ' || up.last_name, 'Unknown'),
          'images', COALESCE((
            SELECT json_agg(json_build_object('id', pi.id, 'image_url', pi.image_url) ORDER BY pi.display_order)
            FROM lost_found_images pi
            WHERE pi.lost_found_id = p.id
          ), '[]'::json)
        ) as partner
      FROM lost_found f
      LEFT JOIN users uf ON uf.id = f.reporter_id
      JOIN lost_found p ON p.id = f.matched_with
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

router.patch('/review/:id', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const client = await pool.connect();
  let reviewItems = [];
  let decision = null;
  try {
    decision = req.body?.decision;
    const { lostId } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approve or reject' });
    }

    await client.query('BEGIN');
    
    // First try to find existing match pending review in the DB
    let reviewResult = await client.query(
      'SELECT id, matched_with, match_score FROM lost_found WHERE id = $1 AND match_review_status = $2',
      [req.params.id, 'pending']
    );

    let review = reviewResult.rows[0];
    let matchedWithId = review?.matched_with || lostId;
    let dynamicScore = 95;

    // If no pending review found but lostId was provided, look up the found item by ID alone
    // This handles the case where the match was just discovered and DB may not have been updated yet
    if (!review && lostId) {
      const fallbackResult = await client.query(
        'SELECT id, matched_with, match_score FROM lost_found WHERE id = $1',
        [req.params.id]
      );
      if (fallbackResult.rows.length > 0) {
        review = fallbackResult.rows[0];
        matchedWithId = lostId; // Use the lostId provided by the frontend
        dynamicScore = review.match_score ? Math.round(Number(review.match_score) * 100) : 95;
      }
    }

    if (!matchedWithId) {
      // Dynamic fallback matching safety net (perfect for cached frontend browsers)
      const foundItemRes = await client.query('SELECT * FROM lost_found WHERE id = $1 AND type = $2 AND status = $3', [req.params.id, 'found', 'open']);
      if (foundItemRes.rows.length > 0) {
        const openLostRes = await client.query("SELECT * FROM lost_found WHERE type = 'lost' AND status = 'open' AND matched_with IS NULL");
        if (openLostRes.rows.length > 0) {
          const ranked = await rankLostFoundCandidates(foundItemRes.rows[0], openLostRes.rows);
          if (ranked.length > 0) {
            matchedWithId = ranked[0].id;
            dynamicScore = Math.round((ranked[0].match_score_raw || 0.95) * 100);
          }
        }
      }
    }

    if (!matchedWithId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending review or lost item link not found' });
    }

    // If it's a new potential match, we want to set matched_with and status first
    if (!review) {
      // Create/initialize match in DB for both items so they are linked
      const itemsRes = await client.query('SELECT id, reporter_id, item_name, type FROM lost_found WHERE id IN ($1, $2)', [req.params.id, matchedWithId]);
      if (itemsRes.rows.length !== 2) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'One or both items not found' });
      }
      
      const foundItemInDb = itemsRes.rows.find(r => r.type === 'found');
      const lostItemInDb = itemsRes.rows.find(r => r.type === 'lost');
      if (!foundItemInDb || !lostItemInDb) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Must match a lost item with a found item' });
      }

      reviewItems = itemsRes.rows;
      review = {
        id: foundItemInDb.id,
        matched_with: lostItemInDb.id,
        match_score: dynamicScore
      };
    } else {
      const reviewItemsResult = await client.query(
        `SELECT id, reporter_id, item_name, type
         FROM lost_found
         WHERE id = ANY($1::uuid[])`,
        [[review.id, matchedWithId]]
      );
      reviewItems = reviewItemsResult.rows;
    }

    if (decision === 'approve') {
      await client.query(
        `UPDATE lost_found
         SET status = 'matched',
             match_review_status = 'approved',
             matched_with = CASE WHEN id = $1 THEN $2 WHEN id = $2 THEN $1 ELSE matched_with END,
             match_score = COALESCE(match_score, $3),
             updated_at = NOW()
         WHERE id IN ($1, $2)`,
        [review.id, matchedWithId, review.match_score]
      );
    } else {
      await client.query(
        `UPDATE lost_found
         SET status = 'open',
             matched_with = CASE WHEN id = $1 THEN $2::uuid ELSE $1::uuid END,
             match_review_status = 'rejected',
             match_score = NULL,
             updated_at = NOW()
         WHERE id IN ($1, $2)`,
        [review.id, matchedWithId]
      );
    }

    await client.query('COMMIT');

    await safeNotify('lost-found review decision', async () => {
      const lostItem = reviewItems.find((item) => item.type === 'lost');
      const foundItem = reviewItems.find((item) => item.type === 'found');

      if (decision === 'approve') {
        if (lostItem) {
          await notifyUser(pool, lostItem.reporter_id, {
            title: 'Item is with OSAS',
            message: `Great news! Your lost item "${lostItem.item_name}" has been matched and is now with the OSAS.`,
            type: 'lostfound',
            link: 'page:lostfound',
          });
        }
        
        const otherReporters = reviewItems
          .filter((item) => item.type !== 'lost')
          .map((item) => item.reporter_id);
          
        if (otherReporters.length > 0) {
          await notifyUsers(pool, otherReporters, {
            title: 'Lost & found match approved',
            message: `The reported match involving "${itemLabel(foundItem)}" was approved. Please coordinate with the office.`,
            type: 'lostfound',
            link: 'page:lostfound',
          });
        }
      } else {
        await notifyUsers(
          pool,
          reviewItems.map((item) => item.reporter_id),
          {
            title: 'Lost & found match rejected',
            message: `The proposed match involving "${itemLabel(reviewItems[0])}" was not approved after review.`,
            type: 'lostfound',
            link: 'page:lostfound',
          }
        );
      }
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

router.post('/match/approve', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const { lostId, foundId } = req.body;
  if (!lostId || !foundId) {
    return res.status(400).json({ error: 'Lost ID and Found ID are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get both items
    const itemsRes = await client.query('SELECT * FROM lost_found WHERE id IN ($1, $2)', [lostId, foundId]);
    if (itemsRes.rows.length !== 2) {
      throw new Error('One or both items not found');
    }

    const lostItem = itemsRes.rows.find(r => r.type === 'lost');
    const foundItem = itemsRes.rows.find(r => r.type === 'found');

    if (!lostItem || !foundItem) {
      throw new Error('Must match a lost item with a found item');
    }

    // 2. Mark both items as approved match
    await client.query(
      `UPDATE lost_found 
       SET updated_at = NOW(), 
           matched_with = CASE WHEN id = $1 THEN $2 ELSE $1 END,
           match_review_status = 'approved',
           status = 'matched'
       WHERE id IN ($1, $2)`,
      [lostId, foundId]
    );

    const { notifyUser } = require('../services/notifications');
    // 3. Notify the lost item reporter
    await notifyUser(pool, lostItem.reporter_id, {
      title: 'Item Found!',
      message: `Great news! Your lost item "${lostItem.item_name}" has been found and is being held at the OSAS office.`,
      type: 'lostfound',
      link: 'page:lostfound',
    });

    await client.query('COMMIT');
    res.json({ message: 'Match approved and reporter notified' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve match error:', err);
    res.status(500).json({ error: err.message || 'Failed to approve match' });
  } finally {
    client.release();
  }
});

router.post('/match/claim', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const { lostId, foundId } = req.body;
  if (!lostId || !foundId) {
    return res.status(400).json({ error: 'Lost ID and Found ID are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE lost_found 
       SET status = 'claimed', 
           updated_at = NOW() 
       WHERE id IN ($1, $2)`,
      [lostId, foundId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Items marked as claimed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Claim match error:', err);
    res.status(500).json({ error: 'Failed to claim items' });
  } finally {
    client.release();
  }
});

router.post('/match/unclaim', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const { lostId, foundId } = req.body;
  if (!lostId || !foundId) {
    return res.status(400).json({ error: 'Lost ID and Found ID are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE lost_found 
       SET status = 'matched', 
           updated_at = NOW() 
       WHERE id IN ($1, $2)`,
      [lostId, foundId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Items unmarked as claimed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Unclaim match error:', err);
    res.status(500).json({ error: 'Failed to unclaim items' });
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
router.patch('/:id', authenticateToken, uploadLostFound.array('images', 5), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { item_name, description, category, location_found, type, contact_info, date_lost_found } = req.body;
    if (!item_name || !description || !type || !date_lost_found || !contact_info || !contact_info.trim()) {
      return res.status(400).json({ error: 'Item name, description, contact information, type, and date lost/found are required' });
    }

    const check = await client.query('SELECT reporter_id FROM lost_found WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Item not found' });
    }
    if (check.rows[0].reporter_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      client.release();
      return res.status(403).json({ error: 'Not authorized' });
    }

    await client.query('BEGIN');

    // Reset previous matches for this item
    await client.query(
      `UPDATE lost_found
       SET matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE matched_with = $1`,
      [id]
    );

    // Update item details
    const result = await client.query(
      `UPDATE lost_found
       SET item_name = $1,
           description = $2,
           category = $3,
           location_found = $4,
           type = $5,
           contact_info = $6,
           date_lost_found = $7,
           matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [item_name, description, category || null, location_found || null, type, contact_info || null, date_lost_found, id]
    );

    // Handle new images upload replacement
    if (req.files && req.files.length > 0) {
      await client.query('DELETE FROM lost_found_images WHERE lost_found_id = $1', [id]);
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        const imageUrl = `/uploads/lostfound/${req.files[i].filename}`;
        await client.query(
          `INSERT INTO lost_found_images (lost_found_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [id, imageUrl, i]
        );
      }
    }

    const hydratedItem = await fetchLostFoundItemWithImages(client, id);
    if (hydratedItem) {
      hydratedItem.image_fingerprints = parseImageFingerprints(req.body.image_fingerprints);
      await maybeQueueAutoMatch(client, hydratedItem);
    }

    await client.query('COMMIT');
    res.json(hydratedItem || result.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Update lost-found error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const check = await client.query('SELECT reporter_id FROM lost_found WHERE id = $1 AND status != \'deleted\'', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
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
    await client.query("UPDATE lost_found SET status = 'deleted', updated_at = NOW() WHERE id = $1", [id]);
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

router.patch('/:id/approve-guest', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE lost_found SET approved = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ message: 'Guest report approved and is now live.', item: result.rows[0] });
  } catch (err) {
    console.error('Approve guest report error:', err);
    res.status(500).json({ error: 'Failed to approve report' });
  }
});

module.exports = router;
