const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadLostFound } = require('../middleware/upload');

// ── AI Matching Helpers ──
const STOP_WORDS = new Set(['a','an','the','is','it','in','on','at','to','for','of','and','or','with','my','i','was','this','that','have','had','been','be','are','were','will','can','its','from','by','not','but','as','me','we','he','she','they','do','did','has']);

function extractKeywords(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function intersection(arr1, arr2) {
  const set2 = new Set(arr2);
  return arr1.filter(w => set2.has(w));
}

function computeMatchScore(item1, item2) {
  let score = 0;

  // Category exact match (strong signal — 35 pts)
  if (item1.category && item2.category && item1.category === item2.category) score += 35;

  // Item name word overlap (up to 50 pts)
  const name1 = extractKeywords(item1.item_name || '');
  const name2 = extractKeywords(item2.item_name || '');
  const nameCommon = intersection(name1, name2);
  score += Math.min(nameCommon.length * 25, 50);

  // Description keyword overlap (up to 30 pts)
  const desc1 = extractKeywords(item1.description || '');
  const desc2 = extractKeywords(item2.description || '');
  const descCommon = intersection(desc1, desc2);
  score += Math.min(descCommon.length * 6, 30);

  // Location similarity (up to 20 pts)
  if (item1.location_found && item2.location_found) {
    const loc1 = extractKeywords(item1.location_found);
    const loc2 = extractKeywords(item2.location_found);
    const locCommon = intersection(loc1, loc2);
    score += Math.min(locCommon.length * 12, 20);
  }

  return Math.min(Math.round(score), 100);
}

// ─────────────────────────────────────────────────────────────
//  GET /api/lost-found
//  - Faculty / Admin  → see everything except 'closed'
//  - Student          → see only 'open' and 'matched' items
//    (resolved items are hidden from students; they only see active cases)
// ─────────────────────────────────────────────────────────────
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
          ) FILTER (WHERE lfi.id IS NOT NULL), '[]'
        ) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
      WHERE lf.status != 'closed'
    `;

    // Students: only see 'lost' type items with open/matched status (no 'found', no 'resolved')
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
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get lost/found error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/lost-found  — faculty and admin only
// ─────────────────────────────────────────────────────────────
router.post('/', authenticateToken, requireRole('faculty', 'admin'), uploadLostFound.array('images', 5), async (req, res) => {
  try {
    const { type, item_name, description, category, location_found, contact_info } = req.body;
    if (!type || !item_name || !description) {
      return res.status(400).json({ error: 'Type, item name, and description are required' });
    }

    const result = await pool.query(
      `INSERT INTO lost_found (reporter_id, type, item_name, description, category, location_found, contact_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, type, item_name, description, category || null, location_found || null, contact_info || null]
    );

    const item = result.rows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        const imageUrl = `/uploads/lostfound/${req.files[i].filename}`;
        await pool.query(
          `INSERT INTO lost_found_images (lost_found_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [item.id, imageUrl, i]
        );
      }
    }

    res.status(201).json({ message: 'Item reported', item });
  } catch (err) {
    console.error('Report item error:', err);
    res.status(500).json({ error: 'Failed to report item' });
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /api/lost-found/:id/status
//  Mark as resolved (or any valid status). Reporter or admin only.
// ─────────────────────────────────────────────────────────────
const VALID_STATUSES = ['open', 'matched', 'claimed', 'resolved', 'closed'];

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

// ─────────────────────────────────────────────────────────────
//  GET /api/lost-found/:id/matches  — AI matching
// ─────────────────────────────────────────────────────────────
router.get('/:id/matches', authenticateToken, async (req, res) => {
  try {
    const targetResult = await pool.query(
      `SELECT lf.*,
        COALESCE(json_agg(json_build_object('id', lfi.id, 'image_url', lfi.image_url)) FILTER (WHERE lfi.id IS NOT NULL), '[]') as images
       FROM lost_found lf
       LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
       WHERE lf.id = $1
       GROUP BY lf.id`,
      [req.params.id]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const target = targetResult.rows[0];

    const oppositeType = target.type === 'lost' ? 'found' : 'lost';
    const candidatesResult = await pool.query(
      `SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
        COALESCE(json_agg(json_build_object('id', lfi.id, 'image_url', lfi.image_url)) FILTER (WHERE lfi.id IS NOT NULL), '[]') as images
       FROM lost_found lf
       LEFT JOIN users u ON lf.reporter_id = u.id
       LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
       WHERE lf.type = $1 AND lf.status != 'closed' AND lf.id != $2
       GROUP BY lf.id, u.first_name, u.last_name
       ORDER BY lf.created_at DESC
       LIMIT 60`,
      [oppositeType, req.params.id]
    );

    const scored = candidatesResult.rows
      .map(c => {
        const score = computeMatchScore(target, c);
        const nameKw1 = extractKeywords(target.item_name || '');
        const nameKw2 = extractKeywords(c.item_name || '');
        const descKw1 = extractKeywords(target.description || '');
        const descKw2 = extractKeywords(c.description || '');
        const common = [...new Set([
          ...intersection(nameKw1, nameKw2),
          ...intersection(descKw1, descKw2),
        ])].slice(0, 5);
        return { ...c, match_score: score, common_keywords: common };
      })
      .filter(c => c.match_score >= 20)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 5);

    res.json({ matches: scored, target });
  } catch (err) {
    console.error('LF match error:', err);
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /api/lost-found/:id  — full update, reporter or admin only
// ─────────────────────────────────────────────────────────────
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

    const result = await pool.query(
      `UPDATE lost_found SET item_name=$1, description=$2, category=$3, location_found=$4,
              type=$5, contact_info=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [item_name, description, category || null, location_found || null, type, contact_info || null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update lost-found error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /api/lost-found/:id  — reporter or admin only
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT reporter_id FROM lost_found WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM lost_found WHERE id = $1', [id]);
    res.json({ message: 'Item deleted' });
  } catch (err) {
    console.error('Delete lost-found error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

module.exports = router;
