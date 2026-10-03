const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const requireLostFound = requirePermission('lost_found');
const { uploadLostFound } = require('../middleware/upload');
const { rankLostFoundCandidates, computeHeuristicMatchScore } = require('../services/lostFoundMatcher');
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
  const [rows] = await client.query(
    `SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
      COALESCE(
        JSON_ARRAYAGG(
          IF(lfi.id IS NOT NULL, JSON_OBJECT('id', lfi.id, 'image_url', lfi.image_url), NULL)
        ),
        JSON_ARRAY()
      ) as images
     FROM lost_found lf
     LEFT JOIN users u ON lf.reporter_id = u.id
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.id = ?
     GROUP BY lf.id, u.first_name, u.last_name`,
    [id]
  );
  return (rows && rows[0]) || null;
}

async function fetchLostFoundCandidates(client, target) {
  const oppositeType = target.type === 'lost' ? 'found' : 'lost';
  const [rows] = await client.query(
    `SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
      COALESCE(
        JSON_ARRAYAGG(
          IF(lfi.id IS NOT NULL, JSON_OBJECT('id', lfi.id, 'image_url', lfi.image_url), NULL)
        ),
        JSON_ARRAY()
      ) as images
     FROM lost_found lf
     LEFT JOIN users u ON lf.reporter_id = u.id
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.type = ?
       AND lf.status = 'open'
       AND COALESCE(lf.match_review_status, 'none') NOT IN ('pending', 'approved')
       AND lf.id != ?
     GROUP BY lf.id, u.first_name, u.last_name
     ORDER BY lf.created_at DESC
     LIMIT 60`,
    [oppositeType, target.id]
  );
  return rows || [];
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
           WHEN id = ? THEN ?
           WHEN id = ? THEN ?
           ELSE matched_with
         END,
         match_review_status = 'pending',
         match_score = ?,
         updated_at = NOW()
     WHERE id IN (?, ?)`,
    [target.id, best.id, best.id, target.id, best.match_score_raw, target.id, best.id]
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
    await pool.query(
      `UPDATE lost_found SET is_archived = true WHERE created_at < NOW() - INTERVAL 4 YEAR AND is_archived = false`
    ).catch(err => console.error('Lost & found auto-archive warning:', err.message));

    await pool.query(
      `DELETE FROM lost_found 
       WHERE status = 'deleted' 
         AND updated_at < NOW() - INTERVAL 6 MONTH`
    ).catch(err => console.error('Auto-delete soft-deleted lost/found error:', err.message));

    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const isFaculty = req.user.role === 'faculty';
    const params = [];

    let query = `
      SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
        COALESCE(
          JSON_ARRAYAGG(
            IF(lfi.id IS NOT NULL, JSON_OBJECT('id', lfi.id, 'image_url', lfi.image_url), NULL)
          ), JSON_ARRAY()
        ) as images,
        (
          SELECT JSON_OBJECT(
            'id', p.id,
            'item_name', p.item_name,
            'description', p.description,
            'type', p.type,
            'category', p.category,
            'location_found', p.location_found,
            'date_lost_found', p.date_lost_found,
            'contact_info', p.contact_info,
            'status', p.status,
            'reporter_name', COALESCE(CONCAT(pu.first_name, ' ', pu.last_name), 'Unknown'),
            'images', COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url))
              FROM lost_found_images pi WHERE pi.lost_found_id = p.id
            ), JSON_ARRAY())
          )
          FROM lost_found p
          LEFT JOIN users pu ON pu.id = p.reporter_id
          WHERE p.id = lf.matched_with
        ) as matched_item
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

    if (!isAdmin) {
      query += ` AND lf.status NOT IN ('resolved', 'claimed', 'closed', 'deleted') AND lf.type = 'lost' AND lf.is_archived = false`;
    } else {
      if (status === 'archived') {
        query += ` AND (lf.is_archived = true OR lf.status = 'deleted')`;
      } else if (status === 'resolved') {
        query += ` AND lf.status IN ('resolved', 'claimed') AND lf.type = 'found'`;
      } else {
        query += ` AND lf.is_archived = false AND lf.status != 'deleted'`;
        if (status) {
          params.push(status);
          query += ` AND lf.status = ?`;
        } else {
          query += ` AND lf.status != 'closed'`;
        }
      }
      if (type && type !== 'pending-guest') {
        params.push(type);
        query += ` AND lf.type = ?`;
      }
    }

    query += ` GROUP BY lf.id, u.first_name, u.last_name
               ORDER BY lf.created_at DESC
               LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    console.error('Get lost/found error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

router.post('/', authenticateToken, requireRole('student', 'faculty', 'admin', 'guest'), uploadLostFound.array('images', 5), async (req, res) => {
  const client = await pool.getConnection();
  let hydratedItem = null;
  let autoMatch = null;
  try {
    const { type, item_name, description, category, location_found, contact_info, date_lost_found } = req.body;
    if (!type || !item_name || !description || !date_lost_found || !contact_info || !contact_info.trim()) {
      client.release();
      return res.status(400).json({ error: 'Type, item name, description, contact information, and date lost/found are required' });
    }

    const actualRole = req.user.actualRole || req.user.role;
    const isAdminUser = actualRole === 'admin' || actualRole === 'superadmin';
    if (isAdminUser && type === 'found') {
      const hasLFModule = actualRole === 'superadmin' ||
        (Array.isArray(req.user.modules) && req.user.modules.includes('lost_found'));
      if (!hasLFModule) {
        client.release();
        return res.status(403).json({ error: 'You do not have access to the Lost & Found module' });
      }
    }

    const isGuest = req.user.role === 'guest';
    const approvedVal = !isGuest;
    const newId = uuidv4();

    await client.beginTransaction();

    await client.query(
      `INSERT INTO lost_found (id, reporter_id, type, item_name, description, category, location_found, contact_info, approved, date_lost_found)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, req.user.id, type, item_name, description, category || null, location_found || null, contact_info || null, approvedVal, date_lost_found]
    );

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        const imageUrl = `/uploads/lostfound/${req.files[i].filename}`;
        const newImgId = uuidv4();
        await client.query(
          `INSERT INTO lost_found_images (id, lost_found_id, image_url, display_order) VALUES (?, ?, ?, ?)`,
          [newImgId, newId, imageUrl, i]
        );
      }
    }

    hydratedItem = await fetchLostFoundItemWithImages(client, newId);
    hydratedItem.image_fingerprints = parseImageFingerprints(req.body.image_fingerprints);
    autoMatch = await maybeQueueAutoMatch(client, hydratedItem);

    await client.commit();

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
    try { await client.rollback(); } catch (_) {}
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

    const [checkRows] = await pool.query('SELECT reporter_id, type FROM lost_found WHERE id = ?', [req.params.id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const item = checkRows[0];
    if (item.reporter_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (status === 'resolved' && item.type !== 'found') {
      return res.status(400).json({ error: 'Only found items can be marked as resolved' });
    }

    await pool.query(
      'UPDATE lost_found SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, req.params.id]
    );
    res.json({ message: 'Status updated' });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

router.get('/matches/rejected', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        l.id as lost_id, l.item_name as lost_name, l.description as lost_description, l.category as lost_category, l.location_found as lost_location, l.contact_info as lost_contact, l.status as lost_status, l.match_review_status as lost_review_status,
        COALESCE(CONCAT(ul.first_name, ' ', ul.last_name), 'Unknown') as lost_reporter_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', li.id, 'image_url', li.image_url))
          FROM lost_found_images li WHERE li.lost_found_id = l.id
        ), JSON_ARRAY()) as lost_images,

        f.id as found_id, f.item_name as found_name, f.description as found_description, f.category as found_category, f.location_found as found_location, f.contact_info as found_contact, f.status as found_status, f.match_review_status as found_review_status,
        COALESCE(CONCAT(uf.first_name, ' ', uf.last_name), 'Unknown') as found_reporter_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url))
          FROM lost_found_images fi WHERE fi.lost_found_id = f.id
        ), JSON_ARRAY()) as found_images,
        
        COALESCE(l.match_score, f.match_score, 0) as match_score,
        GREATEST(l.updated_at, f.updated_at) as rejected_at
      FROM lost_found l
      JOIN lost_found f ON f.id = l.matched_with OR l.id = f.matched_with
      LEFT JOIN users ul ON ul.id = l.reporter_id
      LEFT JOIN users uf ON uf.id = f.reporter_id
      WHERE l.type = 'lost' AND f.type = 'found'
        AND (l.match_review_status = 'rejected' OR f.match_review_status = 'rejected')
        AND l.status != 'deleted' AND f.status != 'deleted'
      ORDER BY GREATEST(l.updated_at, f.updated_at) DESC
    `);

    const matches = (rows || []).map(row => {
      let score = row.match_score ? (Number(row.match_score) > 1 ? Number(row.match_score) / 100 : Number(row.match_score)) : 0;
      if (!score || score <= 0) {
        const fObj = { item_name: row.found_name, description: row.found_description, category: row.found_category, location_found: row.found_location };
        const lObj = { item_name: row.lost_name, description: row.lost_description, category: row.lost_category, location_found: row.lost_location };
        score = computeHeuristicMatchScore(fObj, lObj) / 100;
      }
      return {
        match_score: score,
        lost_item: {
          id: row.lost_id,
          item_name: row.lost_name,
          description: row.lost_description,
          category: row.lost_category,
          location_found: row.lost_location,
          contact_info: row.lost_contact,
          status: row.lost_status,
          match_review_status: row.lost_review_status,
          reporter_name: row.lost_reporter_name,
          images: row.lost_images
        },
        found_item: {
          id: row.found_id,
          item_name: row.found_name,
          description: row.found_description,
          category: row.found_category,
          location_found: row.found_location,
          contact_info: row.found_contact,
          status: row.found_status,
          match_review_status: row.found_review_status,
          reporter_name: row.found_reporter_name,
          images: row.found_images
        }
      };
    });

    res.json(matches);
  } catch (err) {
    console.error('Rejected LF matches error:', err);
    res.status(500).json({ error: 'Failed to fetch rejected matches' });
  }
});

router.patch('/matches/reopen/:foundId', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { foundId } = req.params;
    const lostId = req.body?.lostId || req.query?.lostId;

    const [foundCheck] = await client.query(
      'SELECT id, item_name, description, category, location_found, matched_with, match_review_status FROM lost_found WHERE id = ? AND type = ?',
      [foundId, 'found']
    );
    if (!foundCheck || foundCheck.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Found item not found' });
    }

    let targetLostId = lostId;
    if (!targetLostId) {
      const [lostCheck] = await client.query(
        'SELECT id FROM lost_found WHERE type = ? AND matched_with = ? AND match_review_status = ?',
        ['lost', foundId, 'rejected']
      );
      if (lostCheck.length > 0) {
        targetLostId = lostCheck[0].id;
      } else if (foundCheck[0].matched_with) {
        targetLostId = foundCheck[0].matched_with;
      }
    }

    if (!targetLostId) {
      client.release();
      return res.status(400).json({ error: 'Linked lost item not found' });
    }

    const [lostItemRes] = await client.query(
      'SELECT id, item_name, description, category, location_found FROM lost_found WHERE id = ?',
      [targetLostId]
    );
    const computedScore = (foundCheck.length && lostItemRes.length) 
      ? computeHeuristicMatchScore(foundCheck[0], lostItemRes[0]) / 100 
      : 0.70;

    await client.beginTransaction();
    await client.query(
      `UPDATE lost_found
       SET match_review_status = 'pending',
           status = 'open',
           match_score = ?,
           matched_with = CASE WHEN id = ? THEN ? ELSE ? END,
           updated_at = NOW()
       WHERE id IN (?, ?)`,
      [computedScore, foundId, targetLostId, foundId, foundId, targetLostId]
    );
    await client.commit();
    res.json({ message: 'Match re-opened for review' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Reopen match error:', err);
    res.status(500).json({ error: 'Failed to re-open match' });
  } finally {
    client.release();
  }
});

router.get('/matches/all', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const [existingResult] = await pool.query(`
      SELECT f.*, CONCAT(uf.first_name, ' ', uf.last_name) as reporter_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url))
          FROM lost_found_images fi
          WHERE fi.lost_found_id = f.id
        ), JSON_ARRAY()) as images,
        JSON_OBJECT(
          'id', p.id,
          'item_name', p.item_name,
          'description', p.description,
          'category', p.category,
          'location_found', p.location_found,
          'contact_info', p.contact_info,
          'reporter_name', COALESCE(CONCAT(up.first_name, ' ', up.last_name), 'Unknown'),
          'images', COALESCE((
            SELECT JSON_ARRAYAGG(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url))
            FROM lost_found_images pi
            WHERE pi.lost_found_id = p.id
          ), JSON_ARRAY()),
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

    const matches = (existingResult || []).map(row => {
      let score = row.match_score ? (Number(row.match_score) > 1 ? Number(row.match_score) / 100 : Number(row.match_score)) : 0;
      if (!score || score <= 0) {
        score = computeHeuristicMatchScore(row, row.partner) / 100;
      }
      return {
        match_score: score,
        lost_item: { ...row.partner, id: row.matched_with },
        found_item: { ...row, partner: undefined }
      };
    });

    const [openFound] = await pool.query(`
      SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url))
          FROM lost_found_images fi
          WHERE fi.lost_found_id = lf.id
        ), JSON_ARRAY()) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      WHERE lf.type = 'found' AND lf.status = 'open' AND (lf.matched_with IS NULL OR lf.match_review_status = 'rejected')
    `);

    const [openLost] = await pool.query(`
      SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url))
          FROM lost_found_images fi
          WHERE fi.lost_found_id = lf.id
        ), JSON_ARRAY()) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      WHERE lf.type = 'lost' AND lf.status = 'open' AND (lf.matched_with IS NULL OR lf.match_review_status = 'rejected')
    `);

    const matchedLostIds = new Set(matches.map(m => String(m.lost_item?.id)).filter(Boolean));

    if (openFound.length > 0 && openLost.length > 0) {
      for (const fItem of openFound) {
        try {
          const availableLost = openLost.filter(l => {
            if (matchedLostIds.has(String(l.id))) return false;
            if (fItem.match_review_status === 'rejected' && String(l.id) === String(fItem.matched_with)) return false;
            if (l.match_review_status === 'rejected' && String(fItem.id) === String(l.matched_with)) return false;
            return true;
          });
          if (availableLost.length === 0) continue;

          const ranked = await rankLostFoundCandidates(fItem, availableLost, { minScore: 35 });
          if (ranked.length === 0) continue;

          const best = ranked[0];

          try {
            await pool.query(
              `UPDATE lost_found
               SET matched_with = CASE
                     WHEN id = ? THEN ?
                     WHEN id = ? THEN ?
                     ELSE matched_with
                   END,
                   match_review_status = 'pending',
                   match_score = ?,
                   updated_at = NOW()
               WHERE id IN (?, ?)`,
              [fItem.id, best.id, best.id, fItem.id, best.match_score_raw, fItem.id, best.id]
            );
          } catch (persistErr) {
            console.warn(`Failed to persist discovered match (found=${fItem.id}, lost=${best.id}):`, persistErr.message);
          }

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
    const [rows] = await pool.query(`
      SELECT f.*, CONCAT(uf.first_name, ' ', uf.last_name) as reporter_name,
        COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url))
          FROM lost_found_images fi
          WHERE fi.lost_found_id = f.id
        ), JSON_ARRAY()) as images,
        JSON_OBJECT(
          'id', p.id,
          'item_name', p.item_name,
          'description', p.description,
          'category', p.category,
          'location_found', p.location_found,
          'contact_info', p.contact_info,
          'reporter_name', COALESCE(CONCAT(up.first_name, ' ', up.last_name), 'Unknown'),
          'images', COALESCE((
            SELECT JSON_ARRAYAGG(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url))
            FROM lost_found_images pi
            WHERE pi.lost_found_id = p.id
          ), JSON_ARRAY())
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

    res.json(rows || []);
  } catch (err) {
    console.error('Pending LF review error:', err);
    res.status(500).json({ error: 'Failed to fetch pending match reviews' });
  }
});

router.patch('/review/:id', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const client = await pool.getConnection();
  let reviewItems = [];
  let decision = null;
  try {
    decision = req.body?.decision;
    const { lostId } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      client.release();
      return res.status(400).json({ error: 'Decision must be approve or reject' });
    }

    await client.beginTransaction();
    
    let [reviewResult] = await client.query(
      'SELECT id, matched_with, match_score FROM lost_found WHERE id = ? AND match_review_status = ?',
      [req.params.id, 'pending']
    );

    let review = reviewResult && reviewResult[0];
    let matchedWithId = review?.matched_with || lostId;
    let dynamicScore = 95;

    if (!review && lostId) {
      const [fallbackResult] = await client.query(
        'SELECT id, matched_with, match_score FROM lost_found WHERE id = ?',
        [req.params.id]
      );
      if (fallbackResult.length > 0) {
        review = fallbackResult[0];
        matchedWithId = lostId;
        dynamicScore = review.match_score ? Math.round(Number(review.match_score) * 100) : 95;
      }
    }

    if (!matchedWithId) {
      const [foundItemRes] = await client.query('SELECT * FROM lost_found WHERE id = ? AND type = ? AND status = ?', [req.params.id, 'found', 'open']);
      if (foundItemRes.length > 0) {
        const [openLostRes] = await client.query("SELECT * FROM lost_found WHERE type = 'lost' AND status = 'open' AND matched_with IS NULL");
        if (openLostRes.length > 0) {
          const ranked = await rankLostFoundCandidates(foundItemRes[0], openLostRes);
          if (ranked.length > 0) {
            matchedWithId = ranked[0].id;
            dynamicScore = Math.round((ranked[0].match_score_raw || 0.95) * 100);
          }
        }
      }
    }

    if (!matchedWithId) {
      await client.rollback();
      client.release();
      return res.status(404).json({ error: 'Pending review or lost item link not found' });
    }

    if (!review) {
      const [itemsRes] = await client.query('SELECT id, reporter_id, item_name, type FROM lost_found WHERE id IN (?, ?)', [req.params.id, matchedWithId]);
      if (itemsRes.length !== 2) {
        await client.rollback();
        client.release();
        return res.status(404).json({ error: 'One or both items not found' });
      }
      
      const foundItemInDb = itemsRes.find(r => r.type === 'found');
      const lostItemInDb = itemsRes.find(r => r.type === 'lost');
      if (!foundItemInDb || !lostItemInDb) {
        await client.rollback();
        client.release();
        return res.status(400).json({ error: 'Must match a lost item with a found item' });
      }

      reviewItems = itemsRes;
      review = {
        id: foundItemInDb.id,
        matched_with: lostItemInDb.id,
        match_score: dynamicScore
      };
    } else {
      const [reviewItemsResult] = await client.query(
        `SELECT id, reporter_id, item_name, type
         FROM lost_found
         WHERE id IN (?)`,
        [[review.id, matchedWithId]]
      );
      reviewItems = reviewItemsResult;
    }

    if (decision === 'approve') {
      await client.query(
        `UPDATE lost_found
         SET status = 'matched',
             match_review_status = 'approved',
             matched_with = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? ELSE matched_with END,
             match_score = COALESCE(match_score, ?),
             updated_at = NOW()
         WHERE id IN (?, ?)`,
        [review.id, matchedWithId, matchedWithId, review.id, review.match_score, review.id, matchedWithId]
      );
    } else {
      await client.query(
        `UPDATE lost_found
         SET status = 'open',
             matched_with = CASE WHEN id = ? THEN ? ELSE ? END,
             match_review_status = 'rejected',
             match_score = COALESCE(match_score, ?),
             updated_at = NOW()
         WHERE id IN (?, ?)`,
        [review.id, matchedWithId, review.id, dynamicScore ? dynamicScore / 100 : 0.70, review.id, matchedWithId]
      );
    }

    await client.commit();

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
    try { await client.rollback(); } catch (_) {}
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

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    const [itemsRes] = await client.query('SELECT * FROM lost_found WHERE id IN (?, ?)', [lostId, foundId]);
    if (!itemsRes || itemsRes.length !== 2) {
      throw new Error('One or both items not found');
    }

    const lostItem = itemsRes.find(r => r.type === 'lost');
    const foundItem = itemsRes.find(r => r.type === 'found');

    if (!lostItem || !foundItem) {
      throw new Error('Must match a lost item with a found item');
    }

    await client.query(
      `UPDATE lost_found 
       SET updated_at = NOW(), 
           matched_with = CASE WHEN id = ? THEN ? ELSE ? END,
           match_review_status = 'approved',
           status = 'matched'
       WHERE id IN (?, ?)`,
      [lostId, foundId, lostId, lostId, foundId]
    );

    await notifyUser(pool, lostItem.reporter_id, {
      title: 'Item Found!',
      message: `Great news! Your lost item "${lostItem.item_name}" has been found and is being held at the OSAS office.`,
      type: 'lostfound',
      link: 'page:lostfound',
    });

    await client.commit();
    res.json({ message: 'Match approved and reporter notified' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
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

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    await client.query(
      `UPDATE lost_found 
       SET status = 'claimed', 
           updated_at = NOW() 
       WHERE id IN (?, ?)`,
      [lostId, foundId]
    );

    await client.commit();
    res.json({ message: 'Items marked as claimed' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
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

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    await client.query(
      `UPDATE lost_found 
       SET status = 'matched', 
           updated_at = NOW() 
       WHERE id IN (?, ?)`,
      [lostId, foundId]
    );

    await client.commit();
    res.json({ message: 'Items unmarked as claimed' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
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
  const client = await pool.getConnection();
  try {
    const { id } = req.params;
    const { item_name, description, category, location_found, type, contact_info, date_lost_found } = req.body;
    if (!item_name || !description || !type || !date_lost_found || !contact_info || !contact_info.trim()) {
      client.release();
      return res.status(400).json({ error: 'Item name, description, contact information, type, and date lost/found are required' });
    }

    const [check] = await client.query('SELECT reporter_id FROM lost_found WHERE id = ?', [id]);
    if (!check || check.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Item not found' });
    }
    if (check[0].reporter_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      client.release();
      return res.status(403).json({ error: 'Not authorized' });
    }

    await client.beginTransaction();

    await client.query(
      `UPDATE lost_found
       SET matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE matched_with = ?`,
      [id]
    );

    await client.query(
      `UPDATE lost_found
       SET item_name = ?,
           description = ?,
           category = ?,
           location_found = ?,
           type = ?,
           contact_info = ?,
           date_lost_found = ?,
           matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE id = ?`,
      [item_name, description, category || null, location_found || null, type, contact_info || null, date_lost_found, id]
    );

    if (req.files && req.files.length > 0) {
      await client.query('DELETE FROM lost_found_images WHERE lost_found_id = ?', [id]);
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        const imageUrl = `/uploads/lostfound/${req.files[i].filename}`;
        const newImgId = uuidv4();
        await client.query(
          `INSERT INTO lost_found_images (id, lost_found_id, image_url, display_order) VALUES (?, ?, ?, ?)`,
          [newImgId, id, imageUrl, i]
        );
      }
    }

    const hydratedItem = await fetchLostFoundItemWithImages(client, id);
    if (hydratedItem) {
      hydratedItem.image_fingerprints = parseImageFingerprints(req.body.image_fingerprints);
      await maybeQueueAutoMatch(client, hydratedItem);
    }

    await client.commit();
    res.json(hydratedItem);
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Update lost-found error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { id } = req.params;
    const [check] = await client.query('SELECT reporter_id, status FROM lost_found WHERE id = ?', [id]);
    if (!check || check.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Item not found' });
    }
    if (check[0].reporter_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      client.release();
      return res.status(403).json({ error: 'Not authorized' });
    }

    const isAlreadyDeleted = check[0].status === 'deleted';
    const isPermanent = req.query.permanent === 'true' || isAlreadyDeleted;

    await client.beginTransaction();
    await client.query(
      `UPDATE lost_found
       SET matched_with = NULL,
           match_review_status = 'none',
           match_score = NULL,
           updated_at = NOW()
       WHERE matched_with = ?`,
      [id]
    );

    if (isPermanent) {
      await client.query('DELETE FROM lost_found_images WHERE lost_found_id = ?', [id]);
      await client.query('DELETE FROM lost_found WHERE id = ?', [id]);
    } else {
      await client.query("UPDATE lost_found SET status = 'deleted', updated_at = NOW() WHERE id = ?", [id]);
    }
    await client.commit();

    res.json({ message: isPermanent ? 'Item permanently deleted' : 'Item deleted' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Delete lost-found error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  } finally {
    client.release();
  }
});

router.patch('/:id/approve-guest', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const { id } = req.params;
    const [check] = await pool.query('SELECT * FROM lost_found WHERE id = ?', [id]);
    if (!check || check.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await pool.query(
      `UPDATE lost_found SET approved = true, updated_at = NOW() WHERE id = ?`,
      [id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM lost_found WHERE id = ?', [id]);
    res.json({ message: 'Guest report approved and is now live.', item: updatedRows[0] });
  } catch (err) {
    console.error('Approve guest report error:', err);
    res.status(500).json({ error: 'Failed to approve report' });
  }
});

module.exports = router;
