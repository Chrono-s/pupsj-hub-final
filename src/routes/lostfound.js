const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const { uploadLostFound } = require('../middleware/upload');
const { rankLostFoundCandidates, computeHeuristicMatchScore } = require('../services/lostFoundMatcher');
const { notifyAdmins, notifyUsers, notifyUser, safeNotify } = require('../services/notifications');
const { isValidUuid, safeJsonParse, getPagination } = require('../utils/helpers');

const requireLostFound = requirePermission('lost_found');
const AUTO_MATCH_THRESHOLD = 0.35;
const VALID_STATUSES = ['open', 'matched', 'claimed', 'resolved', 'closed'];

function parseImageFingerprints(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return safeJsonParse(raw, []);
}

function itemLabel(item) {
  return item?.item_name || 'your item';
}

function isStrongAutoMatch(best) {
  return best && typeof best.match_score_raw === 'number' && best.match_score_raw >= AUTO_MATCH_THRESHOLD;
}

function normalizeLfImages(item) {
  if (!item) return item;
  let imgs = safeJsonParse(item.images, []);
  if (!Array.isArray(imgs)) imgs = [];
  item.images = imgs
    .filter(img => img && (img.image_url || typeof img === 'string'))
    .map(img => (typeof img === 'string' ? { id: img, image_url: img } : { id: img.id || img.image_url, image_url: img.image_url }));
  return item;
}

async function fetchLostFoundItemWithImages(client, id) {
  const [rows] = await client.query(
    `SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
      COALESCE(
        CONCAT('[', GROUP_CONCAT(IF(lfi.id IS NOT NULL, JSON_OBJECT('id', lfi.id, 'image_url', lfi.image_url), NULL) SEPARATOR ','), ']'),
        '[]'
      ) as images
     FROM lost_found lf
     LEFT JOIN users u ON lf.reporter_id = u.id
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.id = ?
     GROUP BY lf.id, u.first_name, u.last_name`,
    [id]
  );
  return normalizeLfImages((rows && rows[0]) || null);
}

async function fetchLostFoundCandidates(client, target) {
  const oppositeType = target.type === 'lost' ? 'found' : 'lost';
  const [rows] = await client.query(
    `SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
      COALESCE(
        CONCAT('[', GROUP_CONCAT(IF(lfi.id IS NOT NULL, JSON_OBJECT('id', lfi.id, 'image_url', lfi.image_url), NULL) SEPARATOR ','), ']'),
        '[]'
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
  return (rows || []).map(normalizeLfImages);
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

// ── GET /api/lost-found ─────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE lost_found SET is_archived = true WHERE created_at < NOW() - INTERVAL 4 YEAR AND is_archived = false').catch(() => {});
    await pool.query("DELETE FROM lost_found WHERE status = 'deleted' AND updated_at < NOW() - INTERVAL 6 MONTH").catch(() => {});

    const { type, status } = req.query;
    const { page, limit, offset } = getPagination(req.query, 20);
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const params = [];

    let query = `
      SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(lfi.id IS NOT NULL, JSON_OBJECT('id', lfi.id, 'image_url', lfi.image_url), NULL) SEPARATOR ','), ']'),
          '[]'
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
            'images', JSON_EXTRACT(CONCAT('[', COALESCE((
              SELECT GROUP_CONCAT(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url) SEPARATOR ',')
              FROM lost_found_images pi WHERE pi.lost_found_id = p.id
            ), ''), ']'), '$')
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

    if (!isAdmin) {
      if (req.user.role === 'faculty') {
        query += " AND lf.status != 'deleted' AND lf.approved = true";
      } else {
        params.push(req.user.id);
        query += " AND (lf.status != 'deleted' AND (lf.approved = true OR lf.reporter_id = ?))";
      }
    } else if (type === 'pending-guest') {
      query += " AND lf.approved = false AND lf.status != 'deleted'";
    }

    if (type && type !== 'pending-guest' && ['lost', 'found'].includes(type)) {
      params.push(type);
      query += ' AND lf.type = ?';
    }

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      query += ' AND lf.status = ?';
    }

    query += ' GROUP BY lf.id, u.first_name, u.last_name ORDER BY lf.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await pool.query(query, params);
    const items = (rows || []).map((row) => {
      normalizeLfImages(row);
      if (row.matched_item) {
        if (typeof row.matched_item === 'string') {
          row.matched_item = safeJsonParse(row.matched_item, null);
        }
        if (row.matched_item) normalizeLfImages(row.matched_item);
      }
      return row;
    });

    res.json(items);
  } catch (err) {
    console.error('Get lost & found error:', err);
    res.status(500).json({ error: 'Failed to fetch lost & found items' });
  }
});

// ── POST /api/lost-found ────────────────────────────────────────────────────
router.post('/', authenticateToken, uploadLostFound.array('images', 5), async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { item_name, description, category, location_found, type, contact_info, date_lost_found } = req.body;
    if (!item_name || !description || !type || !date_lost_found || !contact_info || !contact_info.trim()) {
      client.release();
      return res.status(400).json({ error: 'Item name, description, contact info, type, and date are required' });
    }

    const actualRole = req.user.actualRole || req.user.role;
    const isAdminUser = actualRole === 'admin' || actualRole === 'superadmin';
    if (isAdminUser && type === 'found') {
      const hasLFModule = actualRole === 'superadmin' || (Array.isArray(req.user.modules) && req.user.modules.includes('lost_found'));
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
        await client.query(
          'INSERT INTO lost_found_images (id, lost_found_id, image_url, display_order) VALUES (?, ?, ?, ?)',
          [uuidv4(), newId, `/uploads/lostfound/${req.files[i].filename}`, i]
        );
      }
    }

    const hydratedItem = await fetchLostFoundItemWithImages(client, newId);
    hydratedItem.image_fingerprints = parseImageFingerprints(req.body.image_fingerprints);
    const autoMatch = await maybeQueueAutoMatch(client, hydratedItem);

    await client.commit();

    if (autoMatch?.matched) {
      await safeNotify('lost-found auto match', async () => {
        const partner = await fetchLostFoundItemWithImages(pool, autoMatch.partner_id);
        await notifyUsers(pool, [hydratedItem.reporter_id, partner?.reporter_id], {
          title: 'Possible lost & found match found',
          message: `"${itemLabel(hydratedItem)}" may match another report and is waiting for office review.`,
          type: 'lostfound',
          link: 'page:lostfound',
        });
        await notifyAdmins(pool, {
          title: 'Match review needed',
          message: `A possible match between "${itemLabel(hydratedItem)}" and "${itemLabel(partner)}" is ready for review.`,
          type: 'lostfound',
          link: 'page:lostfound',
        });
      });
    }

    res.status(201).json(hydratedItem);
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Create lost-found error:', err);
    res.status(500).json({ error: 'Failed to create report' });
  } finally {
    client.release();
  }
});

// ── GET /api/lost-found/matches/all ─────────────────────────────────────────
router.get('/matches/all', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const [existingResult] = await pool.query(`
      SELECT f.*, CONCAT(uf.first_name, ' ', uf.last_name) as reporter_name,
        CONCAT('[', COALESCE((
          SELECT GROUP_CONCAT(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url) SEPARATOR ',')
          FROM lost_found_images fi
          WHERE fi.lost_found_id = f.id
        ), ''), ']') as images,
        JSON_OBJECT(
          'id', p.id,
          'item_name', p.item_name,
          'description', p.description,
          'category', p.category,
          'location_found', p.location_found,
          'contact_info', p.contact_info,
          'reporter_name', COALESCE(CONCAT(up.first_name, ' ', up.last_name), 'Unknown'),
          'images', JSON_EXTRACT(CONCAT('[', COALESCE((
            SELECT GROUP_CONCAT(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url) SEPARATOR ',')
            FROM lost_found_images pi
            WHERE pi.lost_found_id = p.id
          ), ''), ']'), '$'),
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

    (existingResult || []).forEach(row => {
      normalizeLfImages(row);
      if (typeof row.partner === 'string') {
        row.partner = safeJsonParse(row.partner, null);
      }
      if (row.partner) normalizeLfImages(row.partner);
    });

    const matches = (existingResult || []).map(row => {
      let score = row.match_score ? (Number(row.match_score) > 1 ? Number(row.match_score) / 100 : Number(row.match_score)) : 0;
      if (!score || score <= 0) score = computeHeuristicMatchScore(row, row.partner) / 100;
      return {
        match_score: score,
        lost_item: { ...row.partner, id: row.matched_with },
        found_item: { ...row, partner: undefined }
      };
    });

    const [openFound] = await pool.query(`
      SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
        CONCAT('[', COALESCE((
          SELECT GROUP_CONCAT(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url) SEPARATOR ',')
          FROM lost_found_images fi WHERE fi.lost_found_id = lf.id
        ), ''), ']') as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      WHERE lf.type = 'found' AND lf.status = 'open' AND (lf.matched_with IS NULL OR lf.match_review_status = 'rejected')
    `);

    const [openLost] = await pool.query(`
      SELECT lf.*, CONCAT(u.first_name, ' ', u.last_name) as reporter_name,
        CONCAT('[', COALESCE((
          SELECT GROUP_CONCAT(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url) SEPARATOR ',')
          FROM lost_found_images fi WHERE fi.lost_found_id = lf.id
        ), ''), ']') as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      WHERE lf.type = 'lost' AND lf.status = 'open' AND (lf.matched_with IS NULL OR lf.match_review_status = 'rejected')
    `);

    (openFound || []).forEach(normalizeLfImages);
    (openLost || []).forEach(normalizeLfImages);

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
          if (!availableLost.length) continue;

          const ranked = await rankLostFoundCandidates(fItem, availableLost, { minScore: 35 });
          if (!ranked.length) continue;

          const best = ranked[0];
          try {
            await pool.query(
              `UPDATE lost_found
               SET matched_with = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? ELSE matched_with END,
                   match_review_status = 'pending',
                   match_score = ?,
                   updated_at = NOW()
               WHERE id IN (?, ?)`,
              [fItem.id, best.id, best.id, fItem.id, best.match_score_raw, fItem.id, best.id]
            );
          } catch (_) {}

          matchedLostIds.add(String(best.id));
          matches.push({
            match_score: best.match_score_raw,
            lost_item: { ...best, match_review_status: 'pending' },
            found_item: { ...fItem, match_review_status: 'pending' }
          });
        } catch (_) {}
      }
    }

    matches.sort((a, b) => b.match_score - a.match_score);
    res.json(matches);
  } catch (err) {
    console.error('All LF matches error:', err);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// ── GET /api/lost-found/review/pending ───────────────────────────────────────
router.get('/review/pending', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.*, CONCAT(uf.first_name, ' ', uf.last_name) as reporter_name,
        CONCAT('[', COALESCE((
          SELECT GROUP_CONCAT(JSON_OBJECT('id', fi.id, 'image_url', fi.image_url) SEPARATOR ',')
          FROM lost_found_images fi WHERE fi.lost_found_id = f.id
        ), ''), ']') as images,
        JSON_OBJECT(
          'id', p.id,
          'item_name', p.item_name,
          'description', p.description,
          'category', p.category,
          'location_found', p.location_found,
          'contact_info', p.contact_info,
          'reporter_name', COALESCE(CONCAT(up.first_name, ' ', up.last_name), 'Unknown'),
          'images', JSON_EXTRACT(CONCAT('[', COALESCE((
            SELECT GROUP_CONCAT(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url) SEPARATOR ',')
            FROM lost_found_images pi WHERE pi.lost_found_id = p.id
          ), ''), ']'), '$')
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

    (rows || []).forEach(r => {
      normalizeLfImages(r);
      if (typeof r.partner === 'string') {
        r.partner = safeJsonParse(r.partner, null);
      }
      if (r.partner) normalizeLfImages(r.partner);
    });

    res.json(rows || []);
  } catch (err) {
    console.error('Pending LF review error:', err);
    res.status(500).json({ error: 'Failed to fetch pending match reviews' });
  }
});

// ── PATCH /api/lost-found/review/:id ────────────────────────────────────────
router.patch('/review/:id', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const client = await pool.getConnection();
  try {
    const decision = req.body?.decision;
    const { lostId } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      client.release();
      return res.status(400).json({ error: 'Decision must be approve or reject' });
    }

    await client.beginTransaction();
    const [reviewRows] = await client.query('SELECT id, matched_with, match_score FROM lost_found WHERE id = ?', [req.params.id]);
    if (!reviewRows.length) {
      await client.rollback();
      client.release();
      return res.status(404).json({ error: 'Item not found' });
    }

    const review = reviewRows[0];
    const matchedWithId = review.matched_with || lostId;
    if (!matchedWithId) {
      await client.rollback();
      client.release();
      return res.status(404).json({ error: 'Matched item link not found' });
    }

    const [itemsRes] = await client.query('SELECT id, reporter_id, item_name, type FROM lost_found WHERE id IN (?, ?)', [review.id, matchedWithId]);

    if (decision === 'approve') {
      await client.query(
        `UPDATE lost_found
         SET status = 'matched', match_review_status = 'approved',
             matched_with = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? ELSE matched_with END,
             updated_at = NOW()
         WHERE id IN (?, ?)`,
        [review.id, matchedWithId, matchedWithId, review.id, review.id, matchedWithId]
      );
    } else {
      await client.query(
        `UPDATE lost_found
         SET status = 'open', match_review_status = 'rejected',
             matched_with = CASE WHEN id = ? THEN ? ELSE ? END,
             updated_at = NOW()
         WHERE id IN (?, ?)`,
        [review.id, matchedWithId, review.id, review.id, matchedWithId]
      );
    }

    await client.commit();

    await safeNotify('lost-found review decision', async () => {
      const lostItem = itemsRes.find(item => item.type === 'lost');
      const foundItem = itemsRes.find(item => item.type === 'found');

      if (decision === 'approve') {
        if (lostItem) {
          await notifyUser(pool, lostItem.reporter_id, {
            title: 'Item is with OSAS',
            message: `Great news! Your lost item "${lostItem.item_name}" has been matched and is now with the OSAS.`,
            type: 'lostfound',
            link: 'page:lostfound',
          });
        }
        const otherReporters = itemsRes.filter(item => item.type !== 'lost').map(item => item.reporter_id);
        if (otherReporters.length) {
          await notifyUsers(pool, otherReporters, {
            title: 'Lost & found match approved',
            message: `The reported match involving "${itemLabel(foundItem)}" was approved. Please coordinate with the office.`,
            type: 'lostfound',
            link: 'page:lostfound',
          });
        }
      } else {
        await notifyUsers(pool, itemsRes.map(item => item.reporter_id), {
          title: 'Lost & found match rejected',
          message: `The proposed match involving "${itemLabel(itemsRes[0])}" was not approved after review.`,
          type: 'lostfound',
          link: 'page:lostfound',
        });
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

// ── MATCH ACTION SHORTCUTS ──────────────────────────────────────────────────
router.post('/match/approve', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const { lostId, foundId } = req.body;
  if (!lostId || !foundId) return res.status(400).json({ error: 'Lost ID and Found ID are required' });

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [itemsRes] = await client.query('SELECT * FROM lost_found WHERE id IN (?, ?)', [lostId, foundId]);
    if (!itemsRes || itemsRes.length !== 2) throw new Error('One or both items not found');

    const lostItem = itemsRes.find(r => r.type === 'lost');
    if (!lostItem) throw new Error('Must match a lost item with a found item');

    await client.query(
      `UPDATE lost_found SET updated_at = NOW(), matched_with = CASE WHEN id = ? THEN ? ELSE ? END, match_review_status = 'approved', status = 'matched' WHERE id IN (?, ?)`,
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
    res.status(500).json({ error: err.message || 'Failed to approve match' });
  } finally {
    client.release();
  }
});

router.post('/match/claim', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const { lostId, foundId } = req.body;
  if (!lostId || !foundId) return res.status(400).json({ error: 'Lost ID and Found ID are required' });
  try {
    await pool.query("UPDATE lost_found SET status = 'claimed', updated_at = NOW() WHERE id IN (?, ?)", [lostId, foundId]);
    res.json({ message: 'Items marked as claimed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim items' });
  }
});

router.post('/match/unclaim', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  const { lostId, foundId } = req.body;
  if (!lostId || !foundId) return res.status(400).json({ error: 'Lost ID and Found ID are required' });
  try {
    await pool.query("UPDATE lost_found SET status = 'matched', updated_at = NOW() WHERE id IN (?, ?)", [lostId, foundId]);
    res.json({ message: 'Items unmarked as claimed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unclaim items' });
  }
});

// ── GET /api/lost-found/:id/matches ─────────────────────────────────────────
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

// ── PATCH /api/lost-found/:id ───────────────────────────────────────────────
router.patch('/:id', authenticateToken, uploadLostFound.array('images', 5), async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { id } = req.params;
    const { item_name, description, category, location_found, type, contact_info, date_lost_found } = req.body;
    if (!item_name || !description || !type || !date_lost_found || !contact_info || !contact_info.trim()) {
      client.release();
      return res.status(400).json({ error: 'Item name, description, contact info, type, and date are required' });
    }

    const [check] = await client.query('SELECT reporter_id FROM lost_found WHERE id = ?', [id]);
    if (!check?.length) {
      client.release();
      return res.status(404).json({ error: 'Item not found' });
    }
    if (check[0].reporter_id !== req.user.id && !['admin', 'superadmin'].includes(req.user.role)) {
      client.release();
      return res.status(403).json({ error: 'Not authorized' });
    }

    await client.beginTransaction();
    await client.query("UPDATE lost_found SET matched_with = NULL, match_review_status = 'none', match_score = NULL, updated_at = NOW() WHERE matched_with = ?", [id]);
    await client.query(
      `UPDATE lost_found
       SET item_name = ?, description = ?, category = ?, location_found = ?, type = ?, contact_info = ?, date_lost_found = ?,
           matched_with = NULL, match_review_status = 'none', match_score = NULL, updated_at = NOW()
       WHERE id = ?`,
      [item_name, description, category || null, location_found || null, type, contact_info || null, date_lost_found, id]
    );

    if (req.files && req.files.length > 0) {
      await client.query('DELETE FROM lost_found_images WHERE lost_found_id = ?', [id]);
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        await client.query(
          'INSERT INTO lost_found_images (id, lost_found_id, image_url, display_order) VALUES (?, ?, ?, ?)',
          [uuidv4(), id, `/uploads/lostfound/${req.files[i].filename}`, i]
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

// ── DELETE /api/lost-found/:id ──────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { id } = req.params;
    const [check] = await client.query('SELECT reporter_id, status FROM lost_found WHERE id = ?', [id]);
    if (!check?.length) {
      client.release();
      return res.status(404).json({ error: 'Item not found' });
    }
    if (check[0].reporter_id !== req.user.id && !['admin', 'superadmin'].includes(req.user.role)) {
      client.release();
      return res.status(403).json({ error: 'Not authorized' });
    }

    const isPermanent = req.query.permanent === 'true' || check[0].status === 'deleted';
    await client.beginTransaction();
    await client.query("UPDATE lost_found SET matched_with = NULL, match_review_status = 'none', match_score = NULL, updated_at = NOW() WHERE matched_with = ?", [id]);

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

// ── PATCH /api/lost-found/:id/approve-guest ─────────────────────────────────
router.patch('/:id/approve-guest', authenticateToken, requireRole('admin', 'superadmin'), requireLostFound, async (req, res) => {
  try {
    const { id } = req.params;
    const [check] = await pool.query('SELECT * FROM lost_found WHERE id = ?', [id]);
    if (!check?.length) return res.status(404).json({ error: 'Item not found' });

    await pool.query('UPDATE lost_found SET approved = true, updated_at = NOW() WHERE id = ?', [id]);
    const [updatedRows] = await pool.query('SELECT * FROM lost_found WHERE id = ?', [id]);
    res.json({ message: 'Guest report approved and is now live.', item: updatedRows[0] });
  } catch (err) {
    console.error('Approve guest report error:', err);
    res.status(500).json({ error: 'Failed to approve report' });
  }
});

module.exports = router;
