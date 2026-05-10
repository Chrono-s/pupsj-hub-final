const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';
const MATCH_PANEL_MIN_SCORE = 35;

const STOP_WORDS = new Set([
  'a','an','the','is','it','in','on','at','to','for','of','and','or','with','my','i','was','this',
  'that','have','had','been','be','are','were','will','can','its','from','by','not','but','as','me',
  'we','he','she','they','do','did','has'
]);
const COLOR_WORDS = new Set([
  'black','white','gray','grey','silver','gold','blue','red','green','yellow','orange','pink','purple','brown','beige','maroon','clear'
]);
const BRAND_WORDS = new Set([
  'nike','adidas','puma','jansport','apple','samsung','huawei','oppo','vivo','realme','asus','acer','dell','hp','lenovo','aquaflask','hydroflask','tiger','tupperware'
]);
const ITEM_TYPE_WORDS = new Set([
  'tumbler','bottle','wallet','document','folder','envelope','notebook','id','card','umbrella','flashdrive','usb','phone','charger','bag','backpack','pencilcase','eyeglasses','keys','key','jacket'
]);

function extractKeywords(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function intersection(arr1, arr2) {
  const set2 = new Set(arr2);
  return arr1.filter(w => set2.has(w));
}

function normalizeLooseText(value) {
  return String(value || '').trim().toLowerCase();
}

function daysBetween(left, right) {
  if (!left || !right) return null;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return null;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86400000;
}

function attributeOverlapScore(leftTokens, rightTokens, bonus, penalty) {
  if (!leftTokens.size || !rightTokens.size) return 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return bonus;
  }
  return -penalty;
}

function extractAttributeTokens(item, vocabulary) {
  const tokens = [
    ...extractKeywords(item.item_name || ''),
    ...extractKeywords(item.description || ''),
    ...extractKeywords(item.category || ''),
  ];
  return new Set(tokens.filter(token => vocabulary.has(token)));
}

function extractCodeTokens(item) {
  const tokens = [
    ...extractKeywords(item.item_name || ''),
    ...extractKeywords(item.description || ''),
  ];
  return new Set(tokens.filter(token => /\d/.test(token)));
}

function computeHeuristicMatchScore(item1, item2) {
  let score = 0;

  const category1 = normalizeLooseText(item1.category);
  const category2 = normalizeLooseText(item2.category);
  if (category1 && category2) {
    if (category1 === category2) score += 35;
    else score -= 12;
  }

  const name1 = extractKeywords(item1.item_name || '');
  const name2 = extractKeywords(item2.item_name || '');
  const nameCommon = intersection(name1, name2);
  score += Math.min(nameCommon.length * 25, 50);

  const desc1 = extractKeywords(item1.description || '');
  const desc2 = extractKeywords(item2.description || '');
  const descCommon = intersection(desc1, desc2);
  score += Math.min(descCommon.length * 6, 30);

  score += attributeOverlapScore(
    extractAttributeTokens(item1, COLOR_WORDS),
    extractAttributeTokens(item2, COLOR_WORDS),
    10,
    8
  );
  score += attributeOverlapScore(
    extractAttributeTokens(item1, BRAND_WORDS),
    extractAttributeTokens(item2, BRAND_WORDS),
    18,
    12
  );
  score += attributeOverlapScore(
    extractAttributeTokens(item1, ITEM_TYPE_WORDS),
    extractAttributeTokens(item2, ITEM_TYPE_WORDS),
    16,
    14
  );

  const codes1 = extractCodeTokens(item1);
  const codes2 = extractCodeTokens(item2);
  if (codes1.size && codes2.size) {
    score += attributeOverlapScore(codes1, codes2, 20, 18);
  }

  if (item1.location_found && item2.location_found) {
    const loc1 = extractKeywords(item1.location_found);
    const loc2 = extractKeywords(item2.location_found);
    const locCommon = intersection(loc1, loc2);
    score += Math.min(locCommon.length * 12, 20);
  }

  const daysApart = daysBetween(item1.date_reported, item2.date_reported);
  if (daysApart != null) {
    if (daysApart <= 3) score += 10;
    else if (daysApart <= 7) score += 6;
    else if (daysApart <= 14) score += 3;
  }

  return Math.max(0, Math.min(Math.round(score), 100));
}

function buildCommonKeywords(item1, item2) {
  const tokens = [
    ...intersection(extractKeywords(item1.item_name || ''), extractKeywords(item2.item_name || '')),
    ...intersection(extractKeywords(item1.description || ''), extractKeywords(item2.description || '')),
    ...intersection(extractKeywords(item1.category || ''), extractKeywords(item2.category || '')),
    ...intersection(extractKeywords(item1.location_found || ''), extractKeywords(item2.location_found || '')),
  ];

  return [...new Set(tokens)].slice(0, 5);
}

function buildMatchText(item) {
  return [
    item.item_name || '',
    item.description || '',
    item.category || '',
    item.location_found || '',
  ].filter(Boolean).join(' | ');
}

function toVisionPath(imageUrl) {
  if (!imageUrl) return null;
  const clean = String(imageUrl).replace(/^\/+/, '').replace(/\\/g, '/');
  return clean ? `public/${clean}` : null;
}

function imagePathsFor(item) {
  const images = Array.isArray(item.images) ? item.images : [];
  return images
    .map(img => toVisionPath(img.image_url))
    .filter(Boolean);
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(num, 1));
}

function round4(value) {
  return Math.round(clamp01(value) * 10000) / 10000;
}

async function callSidecarJson(path, payload, timeoutMs = 45000) {
  const res = await fetch(`${AI_SIDECAR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Sidecar HTTP ${res.status}`);
  }

  return res.json();
}

async function rankLostFoundCandidates(target, candidates, options = {}) {
  const minScore = options.minScore ?? MATCH_PANEL_MIN_SCORE;
  const targetImagePaths = imagePathsFor(target);
  const normalizedTarget = {
    ...target,
    image_fingerprints: Array.isArray(target.image_fingerprints) ? target.image_fingerprints : [],
  };
  const normalizedCandidates = (candidates || []).map(candidate => ({
    ...candidate,
    image_fingerprints: Array.isArray(candidate.image_fingerprints) ? candidate.image_fingerprints : [],
  }));

  const mlScores = new Map();
  const visionScores = new Map();
  const imagePairScores = new Map();
  const candidateImageCounts = new Map();

  if (!normalizedCandidates.length) return [];

  try {
    const structured = await callSidecarJson('/lostfound/custom-match', {
      type: normalizedTarget.type || '',
      item_name: normalizedTarget.item_name || '',
      description: normalizedTarget.description || '',
      category: normalizedTarget.category || '',
      location_found: normalizedTarget.location_found || '',
      date_reported: normalizedTarget.date_reported || '',
      image_fingerprints: normalizedTarget.image_fingerprints,
      candidates: normalizedCandidates.map(candidate => ({
        id: String(candidate.id),
        type: candidate.type || '',
        item_name: candidate.item_name || '',
        description: candidate.description || '',
        category: candidate.category || '',
        location_found: candidate.location_found || '',
        date_reported: candidate.date_reported || '',
        image_fingerprints: candidate.image_fingerprints,
      })),
    });

    for (const row of structured.results || []) {
      mlScores.set(String(row.id), clamp01(row.ml_score));
    }
  } catch (err) {
    console.warn('[lostfound] Structured matcher unavailable:', err.message);
  }

  try {
    const targetText = buildMatchText(normalizedTarget);
    const candidatesWithSignals = normalizedCandidates.filter(candidate =>
      buildMatchText(candidate) || imagePathsFor(candidate).length
    );
    for (const candidate of normalizedCandidates) {
      candidateImageCounts.set(String(candidate.id), imagePathsFor(candidate).length);
    }

    if (targetText || targetImagePaths.length) {
      const vision = await callSidecarJson('/lostfound/vision-match', {
        query_text: targetText,
        query_image_paths: targetImagePaths,
        candidates: candidatesWithSignals.map(candidate => ({
          id: String(candidate.id),
          text: buildMatchText(candidate),
          image_paths: imagePathsFor(candidate),
        })),
      }, 60000);

      for (const row of vision.results || []) {
        visionScores.set(String(row.id), clamp01(row.vision_score));
        imagePairScores.set(String(row.id), clamp01(row.image_to_image));
      }
    }
  } catch (err) {
    console.warn('[lostfound] Vision matcher unavailable:', err.message);
  }

  return normalizedCandidates
    .map(candidate => {
      const heuristicRaw = computeHeuristicMatchScore(normalizedTarget, candidate) / 100;
      const structuredRaw = mlScores.get(String(candidate.id));
      const visionRaw = visionScores.get(String(candidate.id));
      const imagePairRaw = imagePairScores.get(String(candidate.id));
      const bothHaveImages = targetImagePaths.length > 0 && (candidateImageCounts.get(String(candidate.id)) || 0) > 0;
      const imageAnalysisUsed = bothHaveImages && typeof imagePairRaw === 'number' && imagePairRaw > 0;
      const categoryMismatch = normalizeLooseText(normalizedTarget.category)
        && normalizeLooseText(candidate.category)
        && normalizeLooseText(normalizedTarget.category) !== normalizeLooseText(candidate.category);

      let combined = heuristicRaw;
      if (imageAnalysisUsed && typeof structuredRaw === 'number' && typeof visionRaw === 'number') {
        combined = (structuredRaw * 0.45) + (imagePairRaw * 0.40) + (visionRaw * 0.10) + (heuristicRaw * 0.05);
      } else if (imageAnalysisUsed && typeof structuredRaw === 'number') {
        combined = (structuredRaw * 0.55) + (imagePairRaw * 0.35) + (heuristicRaw * 0.10);
      } else if (imageAnalysisUsed) {
        combined = (imagePairRaw * 0.70) + (visionRaw * 0.15) + (heuristicRaw * 0.15);
      } else if (typeof structuredRaw === 'number' && typeof visionRaw === 'number') {
        combined = (structuredRaw * 0.65) + (visionRaw * 0.25) + (heuristicRaw * 0.10);
      } else if (typeof structuredRaw === 'number') {
        combined = (structuredRaw * 0.80) + (heuristicRaw * 0.20);
      } else if (typeof visionRaw === 'number') {
        combined = (visionRaw * 0.45) + (heuristicRaw * 0.55);
      }

      if (imageAnalysisUsed && typeof imagePairRaw === 'number') {
        const textSignalStrong = heuristicRaw >= 0.55 || (typeof structuredRaw === 'number' && structuredRaw >= 0.6);
        if (imagePairRaw >= 0.82 && textSignalStrong) combined += 0.05;
        if (imagePairRaw <= 0.2 && textSignalStrong) combined -= 0.12;
      }

      if (typeof structuredRaw === 'number' && typeof visionRaw === 'number' && structuredRaw >= 0.7 && visionRaw >= 0.7) {
        combined += 0.04;
      }

      if (categoryMismatch && !(imageAnalysisUsed && imagePairRaw >= 0.85)) {
        combined -= 0.08;
      }

      const normalizedScore = round4(combined);
      return {
        ...candidate,
        match_score: Math.round(normalizedScore * 100),
        match_score_raw: normalizedScore,
        structured_score: typeof structuredRaw === 'number' ? round4(structuredRaw) : null,
        vision_score: typeof visionRaw === 'number' ? round4(visionRaw) : null,
        image_match_score: imageAnalysisUsed ? round4(imagePairRaw) : null,
        image_analysis_used: imageAnalysisUsed,
        both_have_images: bothHaveImages,
        common_keywords: buildCommonKeywords(normalizedTarget, candidate),
      };
    })
    .filter(candidate => candidate.match_score >= minScore)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 5);
}

module.exports = {
  AI_SIDECAR_URL,
  MATCH_PANEL_MIN_SCORE,
  buildCommonKeywords,
  computeHeuristicMatchScore,
  extractKeywords,
  intersection,
  rankLostFoundCandidates,
};
