import express, { Response } from 'express';
import path from 'path';
import pool from '../config/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { uploadLostFound } from '../middleware/upload';
import { AuthRequest } from '../types';
import {
  LostFoundCandidate,
  LostFoundMatchQuery,
  rankLostFoundMatches,
  shouldAutoMatch,
} from '../services/lostFoundMatcher';

const router = express.Router();

const VALID_STATUSES = ['open', 'matched', 'claimed', 'resolved', 'closed'];
const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';

type VisionScoreRow = {
  id: string;
  vision_score: number;
  image_to_image: number;
  text_to_image: number;
  image_to_text: number;
  text_to_text: number;
};

type CustomScoreRow = {
  id: string;
  ml_score: number;
};

function parseFingerprintPayload(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

async function fetchLostFoundItem(id: string): Promise<LostFoundCandidate | null> {
  const result = await pool.query(
    `SELECT lf.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', lfi.id,
            'image_url', lfi.image_url,
            'image_fingerprint', lfi.image_fingerprint
          )
        ) FILTER (WHERE lfi.id IS NOT NULL),
        '[]'
      ) AS images
     FROM lost_found lf
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.id = $1
     GROUP BY lf.id`,
    [id]
  );
  return (result.rows[0] as LostFoundCandidate | undefined) || null;
}

async function fetchOppositeTypeCandidates(type: 'lost' | 'found', excludeId?: string): Promise<LostFoundCandidate[]> {
  const oppositeType = type === 'lost' ? 'found' : 'lost';
  const params: unknown[] = [oppositeType];
  let whereClause = `lf.type = $1 AND lf.status NOT IN ('resolved', 'closed')`;

  if (excludeId) {
    params.push(excludeId);
    whereClause += ` AND lf.id != $${params.length}`;
  }

  const result = await pool.query(
    `SELECT lf.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', lfi.id,
            'image_url', lfi.image_url,
            'image_fingerprint', lfi.image_fingerprint
          )
        ) FILTER (WHERE lfi.id IS NOT NULL),
        '[]'
      ) AS images
     FROM lost_found lf
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE ${whereClause}
     GROUP BY lf.id
     ORDER BY lf.created_at DESC
     LIMIT 150`,
    params
  );
  return result.rows as LostFoundCandidate[];
}

function imageUrlToLocalPath(imageUrl?: string): string | null {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return null;
  const relative = imageUrl.replace(/^\/+/, '').replace(/\//g, path.sep);
  return path.join(process.cwd(), 'public', relative.replace(/^uploads[\\/]/, `uploads${path.sep}`));
}

function buildCandidateText(item: Pick<LostFoundCandidate, 'item_name' | 'description' | 'category' | 'location_found'>): string {
  return [item.item_name, item.description, item.category || '', item.location_found || '']
    .filter(Boolean)
    .join(' ');
}

async function rerankWithVision(
  query: LostFoundMatchQuery,
  queryImagePaths: string[],
  candidates: LostFoundCandidate[],
): Promise<Map<string, VisionScoreRow>> {
  const payload = {
    query_text: [query.item_name || '', query.description || '', query.category || '', query.location_found || '']
      .filter(Boolean)
      .join(' '),
    query_image_paths: queryImagePaths,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      text: buildCandidateText(candidate),
      image_paths: (candidate.images || [])
        .map((image) => imageUrlToLocalPath(image.image_url))
        .filter((value): value is string => Boolean(value)),
    })),
  };

  if (!payload.query_text.trim() && payload.query_image_paths.length === 0) return new Map<string, VisionScoreRow>();

  try {
    const res = await fetch(`${AI_SIDECAR_URL}/lostfound/vision-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return new Map<string, VisionScoreRow>();
    const data = await res.json() as { results?: VisionScoreRow[] };
    return new Map((data.results || []).map((row) => [row.id, row]));
  } catch {
    return new Map<string, VisionScoreRow>();
  }
}

async function rerankWithCustomModel(
  query: LostFoundMatchQuery,
  candidates: LostFoundCandidate[],
): Promise<Map<string, CustomScoreRow>> {
  const payload = {
    item_name: query.item_name || '',
    description: query.description || '',
    category: query.category || '',
    location_found: query.location_found || '',
    image_fingerprints: query.imageFingerprints || [],
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      item_name: candidate.item_name,
      description: candidate.description,
      category: candidate.category || '',
      location_found: candidate.location_found || '',
      image_fingerprints: (candidate.images || [])
        .map((image) => image.image_fingerprint || '')
        .filter(Boolean),
    })),
  };

  try {
    const res = await fetch(`${AI_SIDECAR_URL}/lostfound/custom-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return new Map<string, CustomScoreRow>();
    const data = await res.json() as { results?: CustomScoreRow[] };
    return new Map((data.results || []).map((row) => [row.id, row]));
  } catch {
    return new Map<string, CustomScoreRow>();
  }
}

function buildMatchQuery(body: Record<string, unknown>): LostFoundMatchQuery {
  return {
    item_name: typeof body.item_name === 'string' ? body.item_name.trim() : '',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    category: typeof body.category === 'string' ? body.category.trim() : null,
    location_found: typeof body.location_found === 'string' ? body.location_found.trim() : null,
    imageFingerprints: parseFingerprintPayload(body.image_fingerprints),
  };
}

async function rankMatchesHybrid(
  query: LostFoundMatchQuery,
  queryImagePaths: string[],
  candidates: LostFoundCandidate[],
  limit = 5,
) {
  const localMatches = rankLostFoundMatches(query, candidates, Math.max(limit * 5, 20));
  const customRows = await rerankWithCustomModel(
    query,
    localMatches.map((match) => match.candidate),
  );
  const visionRows = await rerankWithVision(
    query,
    queryImagePaths,
    localMatches.map((match) => match.candidate),
  );

  const merged = localMatches.map((match) => {
    const vision = visionRows.get(match.candidate.id);
    const custom = customRows.get(match.candidate.id);
    const hasVision = Boolean(vision && vision.vision_score > 0);
    const hasCustom = Boolean(custom && custom.ml_score > 0);
    let combinedScore = match.score;
    if (hasCustom && hasVision) {
      combinedScore = Math.min(1, match.score * 0.45 + custom!.ml_score * 0.3 + vision!.vision_score * 0.25);
    } else if (hasCustom) {
      combinedScore = Math.min(1, match.score * 0.65 + custom!.ml_score * 0.35);
    } else if (hasVision) {
      combinedScore = Math.min(1, match.score * 0.72 + vision!.vision_score * 0.28);
    }
    const confidence: 'high' | 'medium' | 'low' =
      combinedScore >= 0.9 ? 'high'
      : combinedScore >= 0.76 ? 'medium'
      : 'low';
    const reasons = [...match.reasons];
    if (custom) {
      if (custom.ml_score >= 0.9) reasons.unshift('custom campus model strongly matched');
      else if (custom.ml_score >= 0.8) reasons.unshift('custom campus model agreed with the match');
    }
    if (vision) {
      if (vision.image_to_image >= 0.9) reasons.unshift('photo embedding strongly matched');
      else if (vision.vision_score >= 0.82) reasons.unshift('vision model matched the item photos');
      else if (vision.vision_score >= 0.7) reasons.unshift('vision model found similar visual features');
    }
    return {
      ...match,
      score: Number(combinedScore.toFixed(4)),
      confidence,
      reasons: Array.from(new Set(reasons)).slice(0, 5),
      imageScore: Number(Math.max(match.imageScore, vision?.vision_score || 0).toFixed(4)),
    };
  });

  return merged
    .filter((result) => result.score >= 0.42)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

async function attachImagesToItem(itemId: string, files: Express.Multer.File[], imageFingerprints: string[]): Promise<void> {
  for (let i = 0; i < Math.min(files.length, 5); i += 1) {
    const imageUrl = `/uploads/lostfound/${files[i].filename}`;
    await pool.query(
      `INSERT INTO lost_found_images (lost_found_id, image_url, image_fingerprint, display_order)
       VALUES ($1, $2, $3, $4)`,
      [itemId, imageUrl, imageFingerprints[i] || null, i]
    );
  }
}

async function runAutomaticMatching(itemId: string): Promise<{ matched: boolean; matchedWith?: string; score?: number }> {
  const item = await fetchLostFoundItem(itemId);
  if (!item || item.status === 'resolved' || item.status === 'closed') return { matched: false };

  const candidates = await fetchOppositeTypeCandidates(item.type, item.id);
  const parsedImages = Array.isArray(item.images) ? item.images : (typeof item.images === 'string' ? JSON.parse(item.images) : []);
  const queryImagePaths = parsedImages
    .map((image: any) => imageUrlToLocalPath(image.image_url))
    .filter((value: any): value is string => Boolean(value));
  const matches = await rankMatchesHybrid(
    {
      item_name: item.item_name,
      description: item.description,
      category: item.category,
      location_found: item.location_found,
      imageFingerprints: parsedImages
        .map((image: any) => image.image_fingerprint || '')
        .filter(Boolean),
    },
    queryImagePaths,
    candidates
  );

  if (!shouldAutoMatch(matches)) return { matched: false };

  const topMatch = matches[0];
  if (topMatch.candidate.matched_with && topMatch.candidate.matched_with !== item.id) {
    return { matched: false };
  }

  await pool.query(
    `UPDATE lost_found
     SET matched_with = $1,
         match_review_status = 'pending',
         match_score = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [topMatch.candidate.id, topMatch.score, item.id]
  );

  await pool.query(
    `UPDATE lost_found
     SET matched_with = $1,
         match_review_status = 'pending',
         match_score = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [item.id, topMatch.score, topMatch.candidate.id]
  );

  return {
    matched: true,
    matchedWith: topMatch.candidate.id,
    score: topMatch.score,
  };
}

router.get('/review/pending', authenticateToken, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         lf.id,
         lf.item_name,
         lf.description,
         lf.category,
         lf.location_found,
         lf.type,
         lf.status,
         lf.matched_with,
         lf.match_score,
         lf.match_review_status,
         u.first_name || ' ' || u.last_name AS reporter_name,
         COALESCE(
           json_agg(
             DISTINCT jsonb_build_object('id', lfi.id, 'image_url', lfi.image_url)
           ) FILTER (WHERE lfi.id IS NOT NULL), '[]'
         ) AS images,
         json_build_object(
           'id', partner.id,
           'item_name', partner.item_name,
           'description', partner.description,
           'category', partner.category,
           'location_found', partner.location_found,
           'type', partner.type,
           'status', partner.status,
           'match_score', partner.match_score,
           'reporter_name', pu.first_name || ' ' || pu.last_name
         ) AS partner
       FROM lost_found lf
       LEFT JOIN users u ON u.id = lf.reporter_id
       LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
       LEFT JOIN lost_found partner ON partner.id = lf.matched_with
       LEFT JOIN users pu ON pu.id = partner.reporter_id
       WHERE lf.match_review_status = 'pending'
         AND lf.type = 'found'
       GROUP BY lf.id, u.first_name, u.last_name, partner.id, pu.first_name, pu.last_name
       ORDER BY lf.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Pending lost/found reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch pending reviews' });
  }
});

router.patch('/review/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const decision = typeof req.body.decision === 'string' ? req.body.decision : '';
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approve or reject' });
    }

    const result = await pool.query(
      'SELECT id, matched_with FROM lost_found WHERE id = $1 AND match_review_status = $2',
      [req.params.id, 'pending']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pending match review not found' });
    }

    const current = result.rows[0];
    const partnerId = current.matched_with;
    if (!partnerId) {
      return res.status(400).json({ error: 'This item no longer has a pending partner' });
    }

    if (decision === 'approve') {
      await pool.query(
        `UPDATE lost_found
         SET status = CASE WHEN status = 'open' THEN 'matched' ELSE status END,
             match_review_status = 'approved',
             updated_at = NOW()
         WHERE id IN ($1, $2)`,
        [current.id, partnerId]
      );
      return res.json({ message: 'Match approved' });
    }

    await pool.query(
      `UPDATE lost_found
       SET matched_with = NULL,
           match_review_status = 'rejected',
           match_score = NULL,
           updated_at = NOW()
       WHERE id IN ($1, $2)`,
      [current.id, partnerId]
    );
    res.json({ message: 'Match rejected' });
  } catch (err) {
    console.error('Lost/found review decision error:', err);
    res.status(500).json({ error: 'Failed to update review decision' });
  }
});

router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query as Record<string, string>;
    const offset = (Number(page) - 1) * Number(limit);
    const isStudent = req.user!.role === 'student';
    const isAdmin = req.user!.role === 'admin';
    const params: unknown[] = [];

    let query = `
      SELECT lf.*, u.first_name || ' ' || u.last_name AS reporter_name,
        COALESCE(
          json_agg(
            json_build_object('id', lfi.id, 'image_url', lfi.image_url)
          ) FILTER (WHERE lfi.id IS NOT NULL), '[]'
        ) AS images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
      WHERE lf.status != 'closed'
    `;

    if (!isAdmin) {
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
    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get lost/found error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

router.post('/match', authenticateToken, uploadLostFound.array('images', 3), async (req: AuthRequest, res: Response) => {
  try {
    const matchQuery = buildMatchQuery(req.body as Record<string, unknown>);
    const hasMinimumInput = Boolean(
      matchQuery.item_name ||
      matchQuery.description ||
      (matchQuery.imageFingerprints && matchQuery.imageFingerprints.length > 0)
    );

    if (!hasMinimumInput) {
      return res.status(400).json({ error: 'Item name, description, or a photo is required' });
    }

    const candidates = await fetchOppositeTypeCandidates('lost');
    const queryImagePaths = ((req.files as Express.Multer.File[]) || []).map((file) => file.path);
    const matches = await rankMatchesHybrid(matchQuery, queryImagePaths, candidates, 5);
    const highConfidence = matches[0]?.confidence === 'high';
    const mediumConfidence = matches[0]?.confidence === 'medium';

    res.json({
      found: highConfidence,
      possibleMatch: !highConfidence && mediumConfidence,
      exactMatch: highConfidence && (matches[0]?.score || 0) >= 0.82,
      message: highConfidence
        ? 'A strong match was found in the lost and found records.'
        : mediumConfidence
          ? 'Possible matches were found. Please verify the item with the office.'
          : 'No reliable match was found yet.',
      matches: matches.map((match) => ({
        id: match.candidate.id,
        item_name: match.candidate.item_name,
        description: match.candidate.description,
        category: match.candidate.category,
        location_found: match.candidate.location_found,
        status: match.candidate.status,
        images: (match.candidate.images || []).map((image) => ({
          id: image.id,
          image_url: image.image_url,
        })),
        confidence: match.confidence,
        score: match.score,
        reasons: match.reasons,
      })),
    });
  } catch (err) {
    console.error('Match lost/found error:', err);
    res.status(500).json({ error: 'Failed to match item' });
  }
});

router.post('/', authenticateToken, uploadLostFound.array('images', 5), async (req: AuthRequest, res: Response) => {
  try {
    const { type, item_name, description, category, location_found, contact_info } = req.body;
    if (!type || !item_name || !description) {
      return res.status(400).json({ error: 'Type, item name, and description are required' });
    }
    if (!['lost', 'found'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either lost or found' });
    }
    if (req.user!.role !== 'admin' && type !== 'lost') {
      return res.status(403).json({ error: 'Only admins can submit found-item reports' });
    }

    const result = await pool.query(
      `INSERT INTO lost_found (reporter_id, type, item_name, description, category, location_found, contact_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user!.id, type, item_name, description, category || null, location_found || null, contact_info || null]
    );

    const item = result.rows[0];
    const files = (req.files as Express.Multer.File[]) || [];
    const imageFingerprints = parseFingerprintPayload(req.body.image_fingerprints);
    if (files.length > 0) {
      await attachImagesToItem(item.id, files, imageFingerprints);
    }

    let autoMatch = { matched: false };
    try {
      autoMatch = await runAutomaticMatching(item.id);
    } catch (err) {
      console.error('Auto-matching failed (non-fatal):', err);
      // Continue with submission even if auto-matching fails
    }
    res.status(201).json({
      message: autoMatch.matched
        ? type === 'lost'
          ? 'A matching found item is already in the lost and found records'
          : 'This found item matched an existing lost-item report'
        : type === 'lost'
          ? 'Lost item reported. No reliable match was found yet.'
          : 'Found item reported',
      item,
      autoMatch,
    });
  } catch (err) {
    console.error('Report item error:', err);
    res.status(500).json({ error: 'Failed to report item' });
  }
});

router.patch('/:id/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.body.status === 'string' ? req.body.status : '';
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const check = await pool.query('SELECT reporter_id FROM lost_found WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user!.id && req.user!.role !== 'admin') {
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

router.patch('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { item_name, description, category, location_found, type, contact_info } = req.body;
    if (!item_name || !description || !type) {
      return res.status(400).json({ error: 'Item name, description, and type are required' });
    }

    const check = await pool.query('SELECT reporter_id FROM lost_found WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await pool.query(
      `UPDATE lost_found
       SET item_name = $1,
           description = $2,
           category = $3,
           location_found = $4,
           type = $5,
           contact_info = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [item_name, description, category || null, location_found || null, type, contact_info || null, id]
    );

    const autoMatch = await runAutomaticMatching(id);
    res.json({ ...result.rows[0], autoMatch });
  } catch (err) {
    console.error('Update lost-found error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT reporter_id FROM lost_found WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    if (check.rows[0].reporter_id !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM lost_found WHERE id = $1', [id]);
    res.json({ message: 'Item deleted' });
  } catch (err) {
    console.error('Delete lost-found error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

export default router;
