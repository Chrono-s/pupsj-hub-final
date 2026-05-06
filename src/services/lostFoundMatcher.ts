type LostFoundImage = {
  id?: string;
  image_url?: string;
  image_fingerprint?: string | null;
};

export type LostFoundCandidate = {
  id: string;
  type: 'lost' | 'found';
  item_name: string;
  description: string;
  category: string | null;
  location_found: string | null;
  contact_info?: string | null;
  status?: string;
  matched_with?: string | null;
  images?: LostFoundImage[];
};

export type LostFoundMatchQuery = {
  item_name?: string;
  description?: string;
  category?: string | null;
  location_found?: string | null;
  imageFingerprints?: string[];
};

export type LostFoundMatchResult = {
  candidate: LostFoundCandidate;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  imageScore: number;
  textScore: number;
};

type ParsedFingerprint = {
  version: number;
  ahash?: string;
  dhash?: string;
  rgbMean?: number[];
  satMean?: number;
  valMean?: number;
  edgeDensity?: number;
  legacy?: number[];
};

type MatchFeatures = {
  weightedCoverage: number;
  weightedOverlap: number;
  nameCoverage: number;
  phraseOverlap: number;
  charSimilarity: number;
  rarityHit: number;
  uniqueCodeScore: number;
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'ang', 'at', 'bag', 'by', 'for', 'from', 'got', 'has', 'have',
  'i', 'in', 'is', 'it', 'ko', 'kong', 'lost', 'missing', 'my', 'na', 'ng', 'of',
  'on', 'sa', 'something', 'that', 'the', 'this', 'to', 'wallet', 'was', 'with',
  'yung',
]);

const COLORS = [
  'black', 'white', 'gray', 'grey', 'silver', 'gold', 'blue', 'red', 'green',
  'yellow', 'orange', 'pink', 'purple', 'brown', 'beige', 'maroon',
];

const BRANDS = [
  'nike', 'adidas', 'puma', 'jansport', 'apple', 'samsung', 'huawei', 'oppo',
  'vivo', 'realme', 'asus', 'acer', 'dell', 'hp', 'lenovo', 'penshoppe', 'uniqlo',
  'fossil', 'coach', 'charles', 'skechers',
];

const ITEM_TYPES = [
  'wallet', 'cardholder', 'coinpurse', 'bag', 'backpack', 'slingbag', 'phone',
  'cellphone', 'tablet', 'laptop', 'charger', 'umbrella', 'id', 'card', 'notebook',
  'book', 'bottle', 'tumbler', 'watch', 'earbuds', 'earphones', 'headset', 'jacket',
  'hoodie', 'shirt', 'keys', 'key', 'pencil', 'pen', 'mouse', 'flashdrive', 'usb',
  'document', 'folder', 'powerbank', 'eyeglasses', 'glasses',
];

const CATEGORY_SYNONYMS: Record<string, string> = {
  'personal items': 'personal',
  'school supplies': 'school',
  electronics: 'electronics',
  clothing: 'clothing',
  documents: 'documents',
  others: 'others',
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ses') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map(singularize)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function tokenizeWithCodes(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map(singularize)
    .filter((token) => token.length > 1);
}

function normalizeCategory(category?: string | null): string {
  const normalized = normalizeText(category || '');
  return CATEGORY_SYNONYMS[normalized] || normalized;
}

function makeNgrams(text: string, size: number): string[] {
  const cleaned = normalizeText(text).replace(/\s+/g, '');
  if (cleaned.length < size) return cleaned ? [cleaned] : [];
  const grams: string[] = [];
  for (let i = 0; i <= cleaned.length - size; i += 1) {
    grams.push(cleaned.slice(i, i + size));
  }
  return grams;
}

function makePhrases(tokens: string[]): string[] {
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return phrases;
}

function buildFrequencyMap(items: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return map;
}

function mapDotProduct(left: Map<string, number>, right: Map<string, number>): number {
  let total = 0;
  for (const [key, value] of left) {
    total += value * (right.get(key) || 0);
  }
  return total;
}

function mapMagnitude(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) total += value * value;
  return Math.sqrt(total);
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  const denominator = mapMagnitude(left) * mapMagnitude(right);
  if (!denominator) return 0;
  return mapDotProduct(left, right) / denominator;
}

function buildIdfMap(documents: string[][]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(doc);
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const totalDocs = Math.max(documents.length, 1);
  const idf = new Map<string, number>();
  for (const [token, count] of docFreq) {
    idf.set(token, Math.log((1 + totalDocs) / (1 + count)) + 1);
  }
  return idf;
}

function buildTfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = buildFrequencyMap(tokens);
  const vector = new Map<string, number>();
  const maxFreq = Math.max(...tf.values(), 1);

  for (const [token, freq] of tf) {
    const weight = (0.5 + 0.5 * (freq / maxFreq)) * (idf.get(token) || 1);
    vector.set(token, weight);
  }
  return vector;
}

function weightedCoverage(queryTokens: string[], candidateTokenSet: Set<string>, idf: Map<string, number>): number {
  if (!queryTokens.length) return 0;
  let matched = 0;
  let total = 0;
  for (const token of new Set(queryTokens)) {
    const weight = idf.get(token) || 1;
    total += weight;
    if (candidateTokenSet.has(token)) matched += weight;
  }
  return total ? matched / total : 0;
}

function weightedOverlap(queryTokenSet: Set<string>, candidateTokenSet: Set<string>, idf: Map<string, number>): number {
  if (!queryTokenSet.size || !candidateTokenSet.size) return 0;
  const union = new Set([...queryTokenSet, ...candidateTokenSet]);
  let intersectWeight = 0;
  let unionWeight = 0;
  for (const token of union) {
    const weight = idf.get(token) || 1;
    unionWeight += weight;
    if (queryTokenSet.has(token) && candidateTokenSet.has(token)) intersectWeight += weight;
  }
  return unionWeight ? intersectWeight / unionWeight : 0;
}

function extractKnownTerms(tokens: Set<string>, source: string[]): Set<string> {
  const out = new Set<string>();
  for (const item of source) {
    if (tokens.has(item)) out.add(item);
  }
  return out;
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const item of left) {
    if (right.has(item)) hits += 1;
  }
  return hits / Math.max(left.size, right.size);
}

function getUniqueCodes(tokens: string[]): string[] {
  return tokens.filter((token) => /\d/.test(token) || /^[a-z]*\d+[a-z\d-]*$/i.test(token));
}

function charDiceScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const left = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    left.set(pair, (left.get(pair) || 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    const count = left.get(pair) || 0;
    if (count > 0) {
      left.set(pair, count - 1);
      matches += 1;
    }
  }
  return (2 * matches) / ((a.length - 1) + (b.length - 1));
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseLegacyFingerprint(fingerprint: string): ParsedFingerprint {
  const legacy = fingerprint
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 255);
  return { version: 0, legacy };
}

function parseFingerprint(fingerprint?: string | null): ParsedFingerprint | null {
  if (!fingerprint) return null;
  const trimmed = fingerprint.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as ParsedFingerprint;
      return {
        version: Number(parsed.version || 1),
        ahash: typeof parsed.ahash === 'string' ? parsed.ahash : undefined,
        dhash: typeof parsed.dhash === 'string' ? parsed.dhash : undefined,
        rgbMean: Array.isArray(parsed.rgbMean) ? parsed.rgbMean.slice(0, 3).map(Number) : undefined,
        satMean: Number.isFinite(Number(parsed.satMean)) ? Number(parsed.satMean) : undefined,
        valMean: Number.isFinite(Number(parsed.valMean)) ? Number(parsed.valMean) : undefined,
        edgeDensity: Number.isFinite(Number(parsed.edgeDensity)) ? Number(parsed.edgeDensity) : undefined,
      };
    } catch {
      return parseLegacyFingerprint(trimmed);
    }
  }

  return parseLegacyFingerprint(trimmed);
}

function hexToBits(hex?: string): string {
  if (!hex) return '';
  return hex
    .split('')
    .map((char) => Number.parseInt(char, 16).toString(2).padStart(4, '0'))
    .join('');
}

function hammingSimilarity(left?: string, right?: string): number {
  const a = hexToBits(left);
  const b = hexToBits(right);
  if (!a || !b || a.length !== b.length) return 0;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1;
  }
  return 1 - diff / a.length;
}

function averageAbsoluteDifference(left: number[], right: number[]): number {
  if (!left.length || !right.length || left.length !== right.length) return 1;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff += Math.abs(left[i] - right[i]);
  return diff / left.length;
}

function compareFingerprints(queryRaw: string, candidateRaw: string): number {
  const query = parseFingerprint(queryRaw);
  const candidate = parseFingerprint(candidateRaw);
  if (!query || !candidate) return 0;

  if (query.legacy?.length && candidate.legacy?.length) {
    const avgDiff = averageAbsoluteDifference(query.legacy, candidate.legacy);
    return Math.max(0, 1 - avgDiff / 255);
  }

  let score = 0;
  let weight = 0;

  if (query.ahash && candidate.ahash) {
    score += hammingSimilarity(query.ahash, candidate.ahash) * 0.28;
    weight += 0.28;
  }
  if (query.dhash && candidate.dhash) {
    score += hammingSimilarity(query.dhash, candidate.dhash) * 0.36;
    weight += 0.36;
  }
  if (query.rgbMean && candidate.rgbMean) {
    const rgbDiff = averageAbsoluteDifference(query.rgbMean, candidate.rgbMean);
    score += Math.max(0, 1 - rgbDiff / 255) * 0.2;
    weight += 0.2;
  }
  if (typeof query.satMean === 'number' && typeof candidate.satMean === 'number') {
    score += Math.max(0, 1 - Math.abs(query.satMean - candidate.satMean)) * 0.08;
    weight += 0.08;
  }
  if (typeof query.valMean === 'number' && typeof candidate.valMean === 'number') {
    score += Math.max(0, 1 - Math.abs(query.valMean - candidate.valMean)) * 0.05;
    weight += 0.05;
  }
  if (typeof query.edgeDensity === 'number' && typeof candidate.edgeDensity === 'number') {
    score += Math.max(0, 1 - Math.abs(query.edgeDensity - candidate.edgeDensity)) * 0.03;
    weight += 0.03;
  }

  return weight ? score / weight : 0;
}

function getImageScore(queryFingerprints: string[], candidateImages: LostFoundImage[] = []): number {
  if (!queryFingerprints.length || !candidateImages.length) return 0;

  let best = 0;
  for (const queryFingerprint of queryFingerprints) {
    for (const image of candidateImages) {
      if (!image.image_fingerprint) continue;
      best = Math.max(best, compareFingerprints(queryFingerprint, image.image_fingerprint));
    }
  }
  return best;
}

function computeTextFeatures(query: LostFoundMatchQuery, candidate: LostFoundCandidate, corpus: LostFoundCandidate[]): MatchFeatures {
  const queryText = [query.item_name || '', query.description || '', query.category || '', query.location_found || '']
    .filter(Boolean)
    .join(' ');
  const candidateText = [candidate.item_name, candidate.description, candidate.category || '', candidate.location_found || '']
    .filter(Boolean)
    .join(' ');

  const queryTokens = tokenize(queryText);
  const queryNameTokens = tokenize(query.item_name || '');
  const candidateTokens = tokenize(candidateText);
  const candidateNameTokens = tokenize(candidate.item_name);

  const corpusDocs = corpus.map((entry) =>
    tokenize([entry.item_name, entry.description, entry.category || '', entry.location_found || ''].filter(Boolean).join(' '))
  );
  corpusDocs.push(queryTokens);
  const idf = buildIdfMap(corpusDocs);

  const queryVector = buildTfidfVector(queryTokens, idf);
  const candidateVector = buildTfidfVector(candidateTokens, idf);

  const queryCharVector = buildTfidfVector(makeNgrams(queryText, 3), buildIdfMap([
    ...corpus.map((entry) => makeNgrams([entry.item_name, entry.description, entry.category || ''].filter(Boolean).join(' '), 3)),
    makeNgrams(queryText, 3),
  ]));
  const candidateCharVector = buildTfidfVector(makeNgrams(candidateText, 3), buildIdfMap([
    ...corpus.map((entry) => makeNgrams([entry.item_name, entry.description, entry.category || ''].filter(Boolean).join(' '), 3)),
    makeNgrams(queryText, 3),
  ]));

  const queryTokenSet = new Set(queryTokens);
  const candidateTokenSet = new Set(candidateTokens);
  const queryPhraseSet = new Set(makePhrases(queryTokens));
  const candidatePhraseSet = new Set(makePhrases(candidateTokens));
  const queryCodeSet = new Set(getUniqueCodes(tokenizeWithCodes(queryText)));
  const candidateCodeSet = new Set(getUniqueCodes(tokenizeWithCodes(candidateText)));

  let rarityHit = 0;
  for (const token of queryTokenSet) {
    if (candidateTokenSet.has(token) && (idf.get(token) || 0) >= 1.8) rarityHit += Math.min(idf.get(token) || 0, 3);
  }
  rarityHit = Math.min(rarityHit / 6, 1);

  const sharedCodes = [...queryCodeSet].filter((token) => candidateCodeSet.has(token));

  return {
    weightedCoverage: weightedCoverage(queryTokens, candidateTokenSet, idf),
    weightedOverlap: weightedOverlap(queryTokenSet, candidateTokenSet, idf),
    nameCoverage: queryNameTokens.length
      ? weightedCoverage(queryNameTokens, new Set(candidateNameTokens), idf)
      : 0,
    phraseOverlap: overlapScore(queryPhraseSet, candidatePhraseSet),
    charSimilarity: Math.max(
      cosineSimilarity(queryVector, candidateVector),
      cosineSimilarity(queryCharVector, candidateCharVector),
      charDiceScore(normalizeText(queryText).replace(/\s/g, ''), normalizeText(candidateText).replace(/\s/g, ''))
    ),
    rarityHit,
    uniqueCodeScore: sharedCodes.length ? 1 : 0,
  };
}

function getConfidence(score: number, imageScore: number, features: MatchFeatures, reasons: string[]): 'high' | 'medium' | 'low' {
  const hasStrongIdentity = reasons.includes('brand/logo matched') || reasons.includes('unique identifier matched');
  if (score >= 0.9) return 'high';
  if (score >= 0.84 && (imageScore >= 0.86 || hasStrongIdentity || features.weightedCoverage >= 0.78)) return 'high';
  if (score >= 0.68) return 'medium';
  return 'low';
}

export function scoreLostFoundMatch(
  query: LostFoundMatchQuery,
  candidate: LostFoundCandidate,
  corpus: LostFoundCandidate[],
): LostFoundMatchResult {
  const features = computeTextFeatures(query, candidate, corpus);
  const queryText = [query.item_name || '', query.description || '', query.category || '', query.location_found || '']
    .filter(Boolean)
    .join(' ');
  const candidateText = [candidate.item_name, candidate.description, candidate.category || '', candidate.location_found || '']
    .filter(Boolean)
    .join(' ');

  const queryTokens = new Set(tokenize(queryText));
  const candidateTokens = new Set(tokenize(candidateText));
  const queryColors = extractKnownTerms(queryTokens, COLORS);
  const candidateColors = extractKnownTerms(candidateTokens, COLORS);
  const queryBrands = extractKnownTerms(queryTokens, BRANDS);
  const candidateBrands = extractKnownTerms(candidateTokens, BRANDS);
  const queryItems = extractKnownTerms(queryTokens, ITEM_TYPES);
  const candidateItems = extractKnownTerms(candidateTokens, ITEM_TYPES);

  const colorOverlap = overlapScore(queryColors, candidateColors);
  const brandOverlap = overlapScore(queryBrands, candidateBrands);
  const itemOverlap = overlapScore(queryItems, candidateItems);

  const queryCategory = normalizeCategory(query.category);
  const candidateCategory = normalizeCategory(candidate.category);
  const imageScore = getImageScore(query.imageFingerprints || [], candidate.images || []);

  let score = (
    features.weightedCoverage * 0.24 +
    features.weightedOverlap * 0.16 +
    features.nameCoverage * 0.14 +
    features.phraseOverlap * 0.08 +
    features.charSimilarity * 0.18 +
    features.rarityHit * 0.1 +
    features.uniqueCodeScore * 0.1
  );

  const reasons: string[] = [];

  if (itemOverlap > 0) {
    score += 0.09 + itemOverlap * 0.05;
    reasons.push('same item type');
  } else if (queryItems.size && candidateItems.size) {
    score -= 0.24;
  }

  if (brandOverlap > 0) {
    score += 0.12;
    reasons.push('brand/logo matched');
  } else if (queryBrands.size && candidateBrands.size) {
    score -= 0.18;
  }

  if (colorOverlap > 0) {
    score += 0.08;
    reasons.push('color matched');
  } else if (queryColors.size && candidateColors.size) {
    score -= 0.12;
  }

  if (queryCategory && candidateCategory && queryCategory === candidateCategory) {
    score += 0.05;
    reasons.push('same category');
  } else if (queryCategory && candidateCategory && queryCategory !== candidateCategory) {
    score -= 0.06;
  }

  if (features.uniqueCodeScore >= 1) {
    score += 0.12;
    reasons.push('unique identifier matched');
  }

  if (imageScore >= 0.93) {
    score += 0.22;
    reasons.push('photo closely matched');
  } else if (imageScore >= 0.86) {
    score += 0.16;
    reasons.push('photo similarity matched');
  } else if (imageScore >= 0.74) {
    score += 0.08;
    reasons.push('photo had similar visual pattern');
  }

  const normalizedQueryName = normalizeText(query.item_name || '');
  const normalizedCandidateName = normalizeText(candidate.item_name);
  if (normalizedQueryName && normalizedCandidateName.includes(normalizedQueryName)) {
    score += 0.05;
  }

  if (features.weightedCoverage >= 0.82) reasons.push('description details overlapped');
  else if (features.weightedCoverage >= 0.65) reasons.push('several description details matched');
  else if (!reasons.length && score >= 0.58) reasons.push('text similarity matched');

  const finalScore = clamp(score);
  const confidence = getConfidence(finalScore, imageScore, features, reasons);

  return {
    candidate,
    score: Number(finalScore.toFixed(4)),
    confidence,
    reasons,
    imageScore: Number(imageScore.toFixed(4)),
    textScore: Number((
      features.weightedCoverage * 0.35 +
      features.weightedOverlap * 0.2 +
      features.nameCoverage * 0.2 +
      features.phraseOverlap * 0.1 +
      features.charSimilarity * 0.1 +
      features.rarityHit * 0.05
    ).toFixed(4)),
  };
}

export function rankLostFoundMatches(
  query: LostFoundMatchQuery,
  candidates: LostFoundCandidate[],
  limit = 5,
): LostFoundMatchResult[] {
  return candidates
    .map((candidate) => scoreLostFoundMatch(query, candidate, candidates))
    .filter((result) => result.score >= 0.42)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function shouldAutoMatch(matches: LostFoundMatchResult[]): boolean {
  if (!matches.length) return false;
  const [top, runnerUp] = matches;
  const margin = top.score - (runnerUp?.score || 0);

  if (top.confidence !== 'high') return false;
  if (top.score < 0.84) return false;
  if (top.imageScore >= 0.9) return true;
  return margin >= 0.12;
}
