"""
Feedback analyzer — production-quality scikit-learn ML pipeline.

Improvements over prototype:
  • Global TF-IDF vocabulary (loaded from train.py output) so even events
    with 2-3 comments get a rich feature space.
  • Tagalog/Taglish sentiment lexicon as extra signal beyond ratings.
  • Filipino hyperbole detection: "pwede na mamatay", "grabe ganda" etc.
    are positive hyperboles — phrase-level patterns catch them before the
    word-by-word lexicon misclassifies them.
  • Negation-aware scoring: "hindi maganda" flips "maganda" to negative;
    window = 3 tokens, catches Filipino (hindi/di/wala) + English negation.
  • Minimum content filter: very short or empty comments are skipped.
  • Graceful degradation: no clustering when < 3 negative comments,
    no global vocab when model not yet trained.
  • Deterministic (fixed random_state everywhere).
  • All public outputs are JSON-serialisable (no numpy types).
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .preprocess import preprocess_for_tfidf
from .suggestions import generate_suggestions

MODEL_DIR              = Path(__file__).resolve().parent.parent / "models"
SENTIMENT_MODEL_PATH   = MODEL_DIR / "sentiment_model.pkl"
GLOBAL_TFIDF_PATH      = MODEL_DIR / "global_feedback_tfidf.pkl"

MIN_COMMENT_TOKENS = 3   # skip comments that clean to fewer tokens

# Blocklist: obvious non-feedback strings
_SPAM_BLOCKLIST = {
    "test", "testing", "aaa", "bbb", "ccc", "xxx", "yyy", "zzz",
    "asdf", "qwerty", "1234", "12345", "abc", "na", "none", "n/a",
    "no comment", "nothing", "ok", "okay", "sure", "yes", "no",
    "good", "nice", "ok lang", "wala", "wala akong masabi",
}


def _is_real_feedback(raw: str) -> bool:
    """
    Return True only for comments that look like genuine human feedback.
    Rejects: spam, gibberish, all-numbers, emoji-only, blocklisted phrases.
    """
    stripped = raw.strip()
    if not stripped:
        return False

    # Blocklist check (case-insensitive, exact match after strip)
    if stripped.lower() in _SPAM_BLOCKLIST:
        return False

    alpha_chars = [c for c in stripped if c.isalpha()]
    total_chars = [c for c in stripped if not c.isspace()]

    # Must have at least 4 alphabetic characters
    if len(alpha_chars) < 4:
        return False

    # Alpha characters must make up at least 40% of non-whitespace content
    if total_chars and len(alpha_chars) / len(total_chars) < 0.40:
        return False

    # Reject pure repeated-character strings (e.g. "aaaaaaa", "hahaha")
    if len(set(stripped.lower().replace(" ", ""))) <= 2:
        return False

    return True


# ── Filipino hyperbole / phrase-level patterns ────────────────────────────────
# Filipino uses death/pain metaphors to express extreme positivity — these LOOK
# negative word-by-word but are strongly positive in context.
#   "pwede na mamatay"  = "I could die [it's so amazing]"   → POSITIVE
#   "grabe ganda"       = "extremely beautiful/great"        → POSITIVE
#   "sakit ng ganda"    = "painfully beautiful"              → POSITIVE
# Patterns match on the RAW (un-tokenised) comment before lexicon scoring.

_HYPERBOLE_POSITIVE: list[re.Pattern] = [
    # "pwede na (ako) (ma)mamatay" — can already die (from awesomeness)
    re.compile(r"\bpwede\s+na\s+(ako\s+)?(ma)?mamatay\b", re.I),
    # "patay na (ako/siya/kami/tayo)" — already dead (overwhelmed positively)
    re.compile(r"\bpatay\s+na\s+(ako|siya|kami|tayo)\b", re.I),
    # "namatay na (ako)" — died (from how good it was)
    re.compile(r"\bnamatay\s+na\s+(ako|siya|kami)?\b", re.I),
    # "grabe/sobra/todo ang ganda/husay/ayos/saya/sulit"
    re.compile(r"\b(grabe|sobra|todo)\s+(ang\s+)?(ganda|husay|ayos|saya|sulit|klase)\b", re.I),
    # "ang sakit/masakit ng/sa ganda/husay/saya" — painfully good
    re.compile(r"\b(ang\s+)?(sakit|masakit)\s+(ng\s+|sa\s+)?(ganda|husay|saya|galing)\b", re.I),
    # "hindi (ko) kaya ang ganda/husay" — can't handle how good it is
    re.compile(r"\bhindi\s+(ko\s+)?kaya\s+(ang\s+)?(ganda|husay|saya|sulit|galing)\b", re.I),
    # "nakaka-amaze/inspire/wow/bitin/engganyo/tuwa"
    re.compile(r"\b(naka|nakaka)(amaze|inspire|wow|bitin|engganyo|tuwa|kilig|hanga)\b", re.I),
    # "ang ganda/husay/sulit talaga/naman/grabe"
    re.compile(r"\b(ang\s+)?(ganda|husay|ayos|sulit|galing)\s+(talaga|naman|kaya|grabe|sobra)\b", re.I),
    # "hindi makapaniwala sa ganda/husay" — can't believe how good
    re.compile(r"\bhindi\s+makapaniwala\s+(sa\s+)?(ganda|husay|saya|galing)\b", re.I),
    # "OMG grabe/ang ganda/ang husay"
    re.compile(r"\bomg\s+(grabe|ganda|husay|ang\s+ganda|ang\s+husay)\b", re.I),
    # internet slang: "ded/dead (na ako) sa ganda"
    re.compile(r"\b(ded|dead)\s+(na\s+)?(ako\s+)?(sa\s+ganda|from\b)", re.I),
    # "grabe sila" in a positive-event context (performer was amazing)
    re.compile(r"\bgrabe\s+sila\b", re.I),
    # "pinaka-ganda/husay/sulit ng event/seminar"
    re.compile(r"\bpinaka(ganda|husay|ayos|sulit|galing)\b", re.I),
]

# Hyperboles that LOOK positive/intense but actually express negativity
_HYPERBOLE_NEGATIVE: list[re.Pattern] = [
    # "wow/grabe/sobra ang tagal/init/gulo/ingay/boring"
    re.compile(r"\b(wow|grabe|sobra|todo)\s+(ang\s+)?(tagal|init|gulo|ingay|boring|antok|baba|stress)\b", re.I),
    # "ang tagal/init/gulo talaga/naman/sobra"
    re.compile(r"\b(ang\s+)?(tagal|init|gulo|boring|antok|stress)\s+(talaga|naman|kaya|sobra|grabe)\b", re.I),
    # "grabe/sobra ang oras ng/katamad/kabagot"
    re.compile(r"\b(grabe|sobra)\s+(ang\s+)?(katamad|kabagot|katagal|kainit)\b", re.I),
    # "sayang" on its own — expresses disappointment/regret
    re.compile(r"\bsayang\s+(ang\s+)?(oras|pagkakataon|event|effort)\b", re.I),
]

# Negation words — Filipino + English
# When a negation word appears within _NEGATION_WINDOW tokens BEFORE a sentiment
# word, the polarity of that word is flipped:
#   "hindi maganda" → maganda (pos) + hindi → counts as NEGATIVE
#   "hindi masama"  → masama  (neg) + hindi → counts as POSITIVE (double negation)
_NEGATION_WORDS: frozenset[str] = frozenset({
    # Filipino
    "hindi", "di", "huwag", "wala", "walang", "ayaw",
    # English
    "not", "no", "never", "neither", "nor", "without",
    "don't", "doesn't", "didn't", "won't", "wouldn't",
    "can't", "cannot", "isn't", "aren't", "wasn't",
    "weren't", "shouldn't", "couldn't", "hardly", "barely", "scarcely",
})
_NEGATION_WINDOW = 3  # tokens to look back when checking for negation


def _phrase_level_sentiment(raw_text: str) -> str | None:
    """
    Check raw (un-tokenised) text for Filipino hyperbole phrase patterns.
    Returns 'positive', 'negative', or None if no pattern matches.
    Called BEFORE token-by-token lexicon scoring so it takes precedence.
    """
    for pat in _HYPERBOLE_POSITIVE:
        if pat.search(raw_text):
            return "positive"
    for pat in _HYPERBOLE_NEGATIVE:
        if pat.search(raw_text):
            return "negative"
    return None


def _negation_aware_counts(tokens: list[str]) -> tuple[int, int]:
    """
    Count positive/negative lexicon hits with negation awareness.

    For each sentiment word, check if a negation word appears within
    _NEGATION_WINDOW tokens before it. If so, flip the polarity.

    Returns (effective_pos_count, effective_neg_count).
    """
    pos_cnt = 0
    neg_cnt = 0
    for i, token in enumerate(tokens):
        is_pos = token in TAGALOG_POSITIVE
        is_neg = token in TAGALOG_NEGATIVE
        if not (is_pos or is_neg):
            continue
        # Look back up to _NEGATION_WINDOW tokens for a negation word
        window = tokens[max(0, i - _NEGATION_WINDOW): i]
        negated = any(t in _NEGATION_WORDS for t in window)
        if negated:
            neg_cnt += 1 if is_pos else 0
            pos_cnt += 1 if is_neg else 0
        else:
            pos_cnt += 1 if is_pos else 0
            neg_cnt += 1 if is_neg else 0
    return pos_cnt, neg_cnt


# ── Tagalog / Taglish sentiment lexicons ────────────────────────────────────
# Extended bilingual lexicon — used as fallback AFTER phrase-level patterns.
TAGALOG_POSITIVE: set[str] = {
    # Filipino / Taglish positive
    "maganda","magaling","mahusay","maayos","masaya","makulay",
    "masigla","mabilis","malinis","maliwanag","maingat","masipag",
    "magandang","napakaganda","napakagaling","napakahusay",
    "sulit","salamat","nagustuhan","gusto","nagandahan","nagustuhan",
    "enjoy","enjoyed","nag-enjoy","natutunan","natututo","natuto",
    "pinakamahusay","pinakamabuti","kahanga-hanga","kahanga",
    "kapuri-puri","kapuri","maayos","malinaw","maraming salamat",
    "galak","nagpapasalamat","pasalamat","excited","motivated","inspired",
    "ganda","husay","ayos","saya","winning","tagumpay",
    # English positive
    "thanks","thank","appreciate","appreciative","appreciated",
    "excellent","outstanding","wonderful","amazing","awesome","great",
    "good","nice","superb","fantastic","brilliant","helpful","informative",
    "engaging","organized","smooth","enjoyable","fun","entertaining",
    "clear","efficient","professional","timely","punctual","insightful",
    "impressed","satisfied","happy","positive","well-organized","well_organized",
    "useful","relevant","interesting","knowledgeable","inspiring","motivating",
    "recommend","recommended","worth","worthwhile","valuable","meaningful",
    "kudos","bravo","congratulations","props","praise","delightful",
    "effective","productive","successful","neat","perfect","great",
    "learned","gained","informative","educational","enriching",
    "responsive","accommodating","friendly","welcoming","warm",
    "exciting","memorable","impactful","exceptional","stellar",
}

TAGALOG_NEGATIVE: set[str] = {
    # Filipino / Taglish negative
    "malungkot","mahirap","masakit","nakakainis","nakakaloka",
    "nakakabigo","nakakadismaya","dismaya","bigo","nabigo",
    "mainit","malamig","maingay","makulimlim","masama",
    "late","huli","naghintay","naantala","antala","hinihintay",
    "magulo","hindi","kulang","kulangan","kakulangan","walang",
    "boring","nakakainip","inip","nakakaantok","nakakatulog",
    "malabo","kalat","gulo","buwisit","nakaka-stress","stress",
    "pagod","obosen","nawalan","nawala","nawasak","nagsisi",
    "sayang","basura","malas","sumama","bumaba","nasira",
    "naghirap","nahirapan","nahirap","nahuli","nastretch",
    "nakalimutan","naabutan","nasayang","nawalan",
    "poor","masama","di maayos","di maganda","kahiya",
    # English negative
    "delayed","delay","disorganized","malabo","confusing","confused",
    "tired","disappointed","disappointing","bad","terrible","awful",
    "dull","waste","useless","irrelevant","unclear","noisy","cramped",
    "crowded","siksikan","masikip","hot","sweaty","uncomfortable",
    "boring","unengaging","unhelpful","uninformative","unorganized",
    "unprofessional","unpunctual","late","incomplete","lacking",
    "absent","missing","broken","faulty","slow","laggy","offline",
    "wrong","incorrect","invalid","outdated","canceled","postponed",
    "difficult","hard","impossible","error","failure","failed",
    "poor","inadequate","insufficient","unsatisfactory","frustrating",
    "annoying","irritating","stressful","overwhelming","chaotic",
    "unfair","biased","rude","dismissive","unprepared","unresponsive",
    "regret","regretful","waste","wasteful","pointless","meaningless",
    "too long","too short","too slow","too fast","disruptive",
}


def _rating_label(r: int) -> str:
    if r <= 2: return "negative"
    if r == 3: return "neutral"
    return "positive"


def _lexicon_score(raw_text: str, tokens: list[str]) -> str | None:
    """
    Three-layer bilingual sentiment scoring:
      Layer 1 — Phrase-level Filipino hyperbole patterns (highest priority).
                Catches expressions like "pwede na mamatay" (positive) or
                "grabe ang tagal" (negative) that word-by-word matching misses.
      Layer 2 — Negation-aware token lexicon.
                "hindi maganda" → negative; "hindi masama" → positive.

    Returns 'positive', 'negative', 'neutral', or None (no signal found).
    """
    # Layer 1: phrase patterns override everything
    phrase = _phrase_level_sentiment(raw_text)
    if phrase:
        return phrase

    # Layer 2: negation-aware token counts
    pos, neg = _negation_aware_counts(tokens)
    if pos == 0 and neg == 0:
        return None
    if pos > neg:   return "positive"
    if neg > pos:   return "negative"
    return "neutral"


def _lexicon_strength(raw_text: str, tokens: list[str]) -> tuple[int, int]:
    """
    Returns (effective_pos_count, effective_neg_count).
    Phrase-level matches yield a strong signal (2, 0) or (0, 2) so they
    can override near-neutral star ratings in the analyze() logic.
    Token-level uses negation-aware counts.
    """
    phrase = _phrase_level_sentiment(raw_text)
    if phrase == "positive":
        return 2, 0   # strong positive — overrides ambiguous ratings
    if phrase == "negative":
        return 0, 2   # strong negative

    return _negation_aware_counts(tokens)


def _top_terms(
    X, row_mask: np.ndarray, feature_names: np.ndarray, top_n: int = 8
) -> list[dict]:
    if not row_mask.any():
        return []
    sub  = X[row_mask]
    mean = np.asarray(sub.mean(axis=0)).ravel()
    idx  = mean.argsort()[::-1][:top_n]
    return [
        {"keyword": str(feature_names[i]), "score": round(float(mean[i]), 4)}
        for i in idx if mean[i] > 0
    ]


def _cluster_negatives(
    X, neg_mask: np.ndarray, feature_names: np.ndarray
) -> list[dict]:
    n = int(neg_mask.sum())
    if n < 3:
        return []
    k = 2 if n < 6 else 3
    km     = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = km.fit_predict(X[neg_mask])

    themes = []
    for c in sorted(set(labels)):
        mask = labels == c
        sub  = X[neg_mask][mask]
        mean = np.asarray(sub.mean(axis=0)).ravel()
        idx  = mean.argsort()[::-1][:5]
        kws  = [str(feature_names[i]) for i in idx if mean[i] > 0]
        themes.append({
            "theme_id": int(c),
            "size":     int(mask.sum()),
            "share_of_negative": round(float(mask.sum() / n), 4),
            "keywords": kws,
        })
    themes.sort(key=lambda t: t["size"], reverse=True)
    return themes


def _repr_quotes(raw_comments: list[str], mask: np.ndarray, k: int = 2) -> list[str]:
    idx = np.where(mask)[0]
    if idx.size == 0:
        return []
    ranked = sorted(idx, key=lambda i: len(raw_comments[i]), reverse=True)
    return [raw_comments[i] for i in ranked[:k]]


def _collapse_near_duplicates(
    rows: list[dict],
    cleaned_comments: list[str],
    similarity_threshold: float = 0.96,
) -> tuple[list[dict], list[str], int]:
    if len(rows) < 2:
        return rows, cleaned_comments, 0

    unique_rows: list[dict] = []
    unique_cleaned: list[str] = []
    seen_exact: set[tuple[int, str]] = set()
    duplicates_collapsed = 0

    for row, cleaned in zip(rows, cleaned_comments):
        key = (int(row["rating"]), cleaned)
        if cleaned and key in seen_exact:
            duplicates_collapsed += 1
            continue
        seen_exact.add(key)
        unique_rows.append(row)
        unique_cleaned.append(cleaned)

    if len(unique_rows) < 2:
        return unique_rows, unique_cleaned, duplicates_collapsed

    try:
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)
        X = vec.fit_transform(unique_cleaned)
        sim = cosine_similarity(X)
    except Exception:
        return unique_rows, unique_cleaned, duplicates_collapsed

    keep_indices: list[int] = []
    merged: set[int] = set()
    for i, row in enumerate(unique_rows):
        if i in merged:
            continue
        keep_indices.append(i)
        for j in range(i + 1, len(unique_rows)):
            if j in merged:
                continue
            if int(unique_rows[j]["rating"]) != int(row["rating"]):
                continue
            if sim[i, j] >= similarity_threshold:
                merged.add(j)
                duplicates_collapsed += 1

    deduped_rows = [unique_rows[i] for i in keep_indices]
    deduped_cleaned = [unique_cleaned[i] for i in keep_indices]
    return deduped_rows, deduped_cleaned, duplicates_collapsed


def _analysis_quality(
    total_responses: int,
    usable_responses: int,
    raw_usable_responses: int,
    negative_count: int,
    theme_count: int,
    suggestion_count: int,
    duplicates_collapsed: int,
) -> dict:
    usable_ratio = (usable_responses / total_responses) if total_responses else 0.0

    if usable_responses >= 12:
        sample_level = "strong"
    elif usable_responses >= 6:
        sample_level = "moderate"
    elif usable_responses >= 3:
        sample_level = "limited"
    else:
        sample_level = "very_limited"

    if negative_count >= 8:
        complaint_level = "strong"
    elif negative_count >= 4:
        complaint_level = "moderate"
    elif negative_count >= 2:
        complaint_level = "limited"
    elif negative_count == 1:
        complaint_level = "very_limited"
    else:
        complaint_level = "none"

    if usable_responses < 3:
        summary = (
            "Very limited usable sample. Treat complaint themes and suggestions cautiously."
        )
    elif negative_count == 0:
        summary = (
            "No repeated negative signal was found, so improvement suggestions are intentionally conservative."
        )
    elif negative_count < 2:
        summary = (
            "Only one negative comment was found, so suggestions are withheld to avoid overclaiming."
        )
    elif negative_count < 4:
        summary = (
            "Suggestions are based on a small number of negative comments and should be treated as early signals."
        )
    elif usable_ratio < 0.6:
        summary = (
            "Several comments were too short or noisy to use, so insights reflect only the clearer feedback."
        )
    elif duplicates_collapsed > 0:
        summary = (
            "Repeated or near-duplicate comments were merged so the insights reflect unique feedback patterns more fairly."
        )
    else:
        summary = (
            "Insights are backed by repeated feedback patterns from a solid usable sample."
        )

    return {
        "sample_level": sample_level,
        "negative_evidence_level": complaint_level,
        "usable_ratio": round(float(usable_ratio), 4),
        "raw_usable_responses": int(raw_usable_responses),
        "duplicates_collapsed": int(duplicates_collapsed),
        "clustering_reliable": bool(negative_count >= 3 and theme_count > 0),
        "suggestions_reliable": bool(negative_count >= 2 and suggestion_count > 0),
        "summary": summary,
    }


class FeedbackAnalyzer:
    """
    Analyse a batch of feedback rows for one event.

    Uses a global TF-IDF vocabulary (trained across all events) when available,
    falling back to a per-event vocabulary so it always works.
    """

    def __init__(
        self,
        sentiment_model_path: Path | None = SENTIMENT_MODEL_PATH,
        global_tfidf_path:    Path | None = GLOBAL_TFIDF_PATH,
    ) -> None:
        self.sentiment_pipeline = None
        self.global_vectorizer: TfidfVectorizer | None = None

        if sentiment_model_path and sentiment_model_path.exists():
            try:
                self.sentiment_pipeline = joblib.load(sentiment_model_path)
            except Exception as e:
                print(f"[analyzer] sentiment model load error: {e}")

        if global_tfidf_path and global_tfidf_path.exists():
            try:
                self.global_vectorizer = joblib.load(global_tfidf_path)
            except Exception as e:
                print(f"[analyzer] global TF-IDF load error: {e}")

    # ── Main analysis method ──────────────────────────────────────────────
    def analyze(
        self,
        feedback: list[dict],
        event_title: str | None = None,
    ) -> dict:
        """
        Args:
            feedback: [{"rating": 1-5, "comment": str}, ...]
            event_title: echoed back in result
        """
        # Filter: must be real feedback with enough meaningful tokens
        rows = []
        for f in feedback:
            comment = (f.get("comment") or "").strip()
            if (
                _is_real_feedback(comment)
                and len(preprocess_for_tfidf(comment).split()) >= MIN_COMMENT_TOKENS
            ):
                rows.append({"rating": int(f["rating"]), "comment": comment})

        if not rows:
            return {
                "event_title":    event_title,
                "total_responses": len(feedback),
                "usable_responses": 0,
                "error": (
                    "No genuine feedback comments found for analysis. "
                    "Comments must be in English or Filipino and contain "
                    "at least 3 meaningful words."
                ),
            }

        raw_usable_responses = len(rows)
        cleaned_initial = [preprocess_for_tfidf(r["comment"]) for r in rows]
        rows, cleaned, duplicates_collapsed = _collapse_near_duplicates(rows, cleaned_initial)

        ratings      = np.array([r["rating"] for r in rows])
        raw_comments = [r["comment"] for r in rows]
        token_lists  = [c.split() for c in cleaned]

        # ── Vectorise ─────────────────────────────────────────────────────
        if self.global_vectorizer is not None:
            # Use pre-trained global vocabulary for richer features
            try:
                X = self.global_vectorizer.transform(cleaned)
                feature_names = self.global_vectorizer.get_feature_names_out()
                vocab_source = "global"
            except Exception:
                X = None
        else:
            X = None

        if X is None:
            # Per-event fallback (always works, even without training)
            local_vec = TfidfVectorizer(
                ngram_range=(1, 2), min_df=1, max_df=0.95,
                max_features=400, sublinear_tf=True,
            )
            X = local_vec.fit_transform(cleaned)
            feature_names = local_vec.get_feature_names_out()
            vocab_source = "local"

        # ── Sentiment labels ──────────────────────────────────────────────
        # Layer 1: rating-based ground truth
        labels = np.array([_rating_label(r) for r in ratings])

        # Layer 2: Lexicon refinement — refine neutral AND override near-neutral ratings.
        # Uses phrase-level hyperbole detection + negation-aware token scoring so that:
        #   • "pwede na mamatay" (death hyperbole) is correctly read as POSITIVE
        #   • "hindi maganda" (negated positive) is correctly read as NEGATIVE
        #   • Neutral (3★): use lexicon to tip positive/negative
        #   • Positive (4★) with strong negative text (≥2 neg, 0 pos) → downgrade to neutral
        #   • Negative (2★) with strong positive text (≥2 pos, 0 neg) → upgrade to neutral
        for i, (lbl, tokens, rating) in enumerate(zip(labels, token_lists, ratings)):
            raw = raw_comments[i]
            pos_cnt, neg_cnt = _lexicon_strength(raw, tokens)
            if lbl == "neutral":
                lex = _lexicon_score(raw, tokens)
                if lex:
                    labels[i] = lex
            elif lbl == "positive" and rating == 4:
                # 4-star but text is clearly negative → treat as neutral
                if neg_cnt >= 2 and pos_cnt == 0:
                    labels[i] = "neutral"
            elif lbl == "negative" and rating == 2:
                # 2-star but text is clearly positive → treat as neutral
                if pos_cnt >= 2 and neg_cnt == 0:
                    labels[i] = "neutral"

        # Layer 3: trained classifier (refines remaining neutral only)
        if self.sentiment_pipeline is not None and len(cleaned) >= 3:
            try:
                predicted = self.sentiment_pipeline.predict(cleaned)
                for i, (lbl, pred) in enumerate(zip(labels, predicted)):
                    if lbl == "neutral":
                        labels[i] = pred
            except Exception as e:
                print(f"[analyzer] classifier predict error: {e}")

        sentiment_source = "rating + bilingual_lexicon" + (
            " + trained_classifier" if self.sentiment_pipeline else ""
        )

        pos_mask = labels == "positive"
        neu_mask = labels == "neutral"
        neg_mask = labels == "negative"

        # ── Term extraction ───────────────────────────────────────────────
        top_praises    = _top_terms(X, pos_mask, feature_names)
        top_complaints = _top_terms(X, neg_mask, feature_names)

        # ── Complaint theme clustering ────────────────────────────────────
        complaint_themes = _cluster_negatives(X, neg_mask, feature_names)

        # ── Representative quotes ─────────────────────────────────────────
        sample_praises    = _repr_quotes(raw_comments, pos_mask)
        sample_complaints = _repr_quotes(raw_comments, neg_mask)

        # ── Suggestions ───────────────────────────────────────────────────
        negative_count = int(neg_mask.sum())
        complaint_kw_flat = [t["keyword"] for t in top_complaints]
        cluster_kw        = [t["keywords"] for t in complaint_themes]
        if negative_count >= 2:
            suggestions = generate_suggestions(
                complaint_kw_flat,
                cluster_kw,
                max_suggestions=5 if negative_count >= 4 else 2,
                min_hit_count=2 if negative_count >= 6 else 1,
            )
        else:
            suggestions = []

        # ── Rating distribution ───────────────────────────────────────────
        dist = Counter(int(r) for r in ratings)
        rating_distribution = {str(i): int(dist.get(i, 0)) for i in range(1, 6)}
        analysis_quality = _analysis_quality(
            total_responses=int(len(feedback)),
            usable_responses=int(len(rows)),
            raw_usable_responses=int(raw_usable_responses),
            negative_count=negative_count,
            theme_count=len(complaint_themes),
            suggestion_count=len(suggestions),
            duplicates_collapsed=int(duplicates_collapsed),
        )

        return {
            "event_title": event_title,
            "total_responses":  int(len(feedback)),
            "usable_responses": int(len(rows)),
            "raw_usable_responses": int(raw_usable_responses),
            "duplicate_comments_collapsed": int(duplicates_collapsed),
            "average_rating":   round(float(ratings.mean()), 2),
            "rating_distribution": rating_distribution,
            "sentiment_breakdown": {
                "positive": int(pos_mask.sum()),
                "neutral":  int(neu_mask.sum()),
                "negative": int(neg_mask.sum()),
            },
            "top_praises":    top_praises,
            "top_complaints": top_complaints,
            "complaint_themes": complaint_themes,
            "sample_praise_quotes":    sample_praises,
            "sample_complaint_quotes": sample_complaints,
            "suggestions": suggestions,
            "analysis_quality": analysis_quality,
            "model_info": {
                "vectorizer":    f"TfidfVectorizer (vocab_source={vocab_source})",
                "clustering":    "KMeans (auto k=2–3, seed=42)",
                "sentiment":     sentiment_source,
                "min_tokens":    MIN_COMMENT_TOKENS,
            },
        }
