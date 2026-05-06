"""
Train an improved Filipino/Taglish sentiment classifier for PUPSJ HUB feedback.

Improvements over the basic train.py
-------------------------------------
• Augments real DB feedback with curated Filipino/Taglish synthetic examples
  so the classifier learns cultural expression patterns from day one.
• Includes Filipino hyperbole patterns (positive death-metaphors, intensifiers).
• Includes negation patterns ("hindi maganda" = negative).
• Uses a stronger feature set: char n-grams + word n-grams for morphology.
• Logs a detailed per-class breakdown so you know which patterns are learned.

Outputs (saved to ai/models/)
------------------------------
  sentiment_model.pkl        — updated TF-IDF + LogisticRegression pipeline
  global_feedback_tfidf.pkl  — global TF-IDF (richer per-event features)

Usage
-----
    python -m ai.ml.train_sentiment      # from project root
    python ai/ml/train_sentiment.py      # direct run

When to re-run
--------------
  • After collecting ~50+ new feedback comments (monthly or after big events).
  • After adding new synthetic examples to SYNTHETIC_EXAMPLES below.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections import Counter
from pathlib import Path

import asyncpg
import joblib
import numpy as np
from dotenv import load_dotenv

# Force UTF-8 output on Windows terminals
import sys as _sys
if _sys.stdout.encoding and _sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        _sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import FunctionTransformer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from ai.ml.preprocess import preprocess_for_tfidf  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

DB_URL = (
    f"postgresql://{os.getenv('DB_USER', 'postgres')}:"
    f"{os.getenv('DB_PASSWORD', '')}@"
    f"{os.getenv('DB_HOST', 'localhost')}:"
    f"{os.getenv('DB_PORT', '5432')}/"
    f"{os.getenv('DB_NAME', 'pupsj_hub')}"
)
MODEL_DIR            = Path(__file__).resolve().parent.parent / "models"
SENTIMENT_MODEL_PATH = MODEL_DIR / "sentiment_model.pkl"
GLOBAL_TFIDF_PATH    = MODEL_DIR / "global_feedback_tfidf.pkl"

MIN_SAMPLES_FOR_TRAINING = 10   # lowered because we augment with synthetic data


# ── Curated synthetic training examples ─────────────────────────────────────
# Hand-labelled Filipino/Taglish examples covering patterns that pure DB data
# might not capture until many events have been held.
# Format: (raw_text, label)  — label is "positive", "neutral", or "negative"

SYNTHETIC_EXAMPLES: list[tuple[str, str]] = [
    # ── Filipino positive hyperboles (look negative, are positive) ──────────
    ("Grabe ganda ng event, pwede na mamatay!", "positive"),
    ("Pwede na akong mamatay sa ganda ng program", "positive"),
    ("Patay na ako sa sobrang saya ng event na ito", "positive"),
    ("Grabe ang husay ng speakers, hindi ko kaya!", "positive"),
    ("Ang sakit ng ganda nito sobra!", "positive"),
    ("Nakaka-amaze talaga, grabe sila", "positive"),
    ("Hindi makapaniwala sa ganda ng event", "positive"),
    ("OMG grabe ang ganda, sulit na sulit!", "positive"),
    ("Namatay na ako sa ganda ng performers", "positive"),
    ("Ang ganda naman talaga ng event na ito, grabe!", "positive"),
    ("Pinaka-sulit na event na napuntahan ko", "positive"),
    ("Dead na ako from how good this event was", "positive"),
    ("Todo husay ng organizers, nakaka-inspired!", "positive"),
    ("Ang sakit ng saya ng event na to, grabe!", "positive"),
    ("Sobra ang ganda ng production, hindi ko kaya!", "positive"),

    # ── Filipino negation examples ──────────────────────────────────────────
    ("Hindi maganda ang event, maraming mali", "negative"),
    ("Di maganda ang pagkakaayos, magulo", "negative"),
    ("Hindi ako nasiyahan sa resulta ng event", "negative"),
    ("Wala akong natutunang bago sa seminar na ito", "negative"),
    ("Hindi maayos ang pagkakaayos ng programa", "negative"),
    ("Di ko naintindihan ang mga sinasabi ng speaker", "negative"),
    ("Hindi sulit ang bayad, kulang ang content", "negative"),
    ("Hindi ako magre-recommend ng event na ito", "negative"),

    # ── Standard Filipino positive ──────────────────────────────────────────
    ("Napakaganda ng event, maraming natutunang bago!", "positive"),
    ("Mahusay ang mga organizers, maayos ang lahat", "positive"),
    ("Napakasaya ng event, nag-enjoy talaga kami!", "positive"),
    ("Sulit na sulit, maraming natutunang bago", "positive"),
    ("Kahanga-hanga ang program, kapuri-puri ang lahat", "positive"),
    ("Magaling ang speakers, malinaw ang explanations", "positive"),
    ("Masaya at masigla ang event, gustong-gusto namin", "positive"),
    ("Excellent na event, organized at smooth ang flow", "positive"),
    ("Ang galing ng presenters, inspiring ang mga topics", "positive"),
    ("Salamat sa pagbibigay ng ganitong klase ng event!", "positive"),
    ("Napaka-informative, maraming valuable insights", "positive"),
    ("Best event sa semester! Sana maulit!", "positive"),
    ("Very well organized. Enjoyed every minute!", "positive"),
    ("Kudos to the organizers! Excellent job!", "positive"),
    ("Great event overall, I learned so much.", "positive"),

    # ── Standard Filipino negative ──────────────────────────────────────────
    ("Malungkot ang event, boring at walang alam", "negative"),
    ("Nakakadismaya, hindi akma sa inaasahan ko", "negative"),
    ("Makulimlim ang organisasyon, magulo at late", "negative"),
    ("Nahirapan akong makinig dahil sa maingay na venue", "negative"),
    ("Masyadong mahaba at nakakaantok ang program", "negative"),
    ("Kulang ang preparasyon ng mga organizers", "negative"),
    ("Sayang ang oras, walang nangyari na kapaki-pakinabang", "negative"),
    ("Disappointed ako sa quality ng event", "negative"),
    ("Disorganized ang event, maraming hiccups", "negative"),
    ("Boring, hindi engaging ang mga activities", "negative"),
    ("Masikip at mainit ang venue, uncomfortable lahat", "negative"),
    ("Late at walang respeto sa oras ng attendees", "negative"),
    ("Poor sound system, hindi marinig ang speakers", "negative"),
    ("Terrible event, waste of time honestly", "negative"),
    ("Very disappointing, did not meet expectations at all", "negative"),

    # ── Neutral / mixed ─────────────────────────────────────────────────────
    ("Ok lang, may kakulangan pero may magandang parte rin", "neutral"),
    ("Pwede na, hindi naman masama pero hindi rin amazing", "neutral"),
    ("Average lang, hindi ako impressed pero hindi rin bad", "neutral"),
    ("Some parts were good, some were lacking. Fair overall.", "neutral"),
    ("Interesting topic but execution could be improved", "neutral"),
    ("Hindi masama pero may room for improvement", "neutral"),
    ("So-so lang, expected more based on the theme", "neutral"),
    ("Mixed feelings, some parts were great some were not", "neutral"),
    ("Pwede pa, hindi perfect pero okay naman overall", "neutral"),
    ("Medyo average lang, expected more pero hindi naman bad", "neutral"),
    ("Fair enough, may mga okay na parts pero may kulang din", "neutral"),
    ("Acceptable lang, not great not terrible", "neutral"),
    ("Mediocre but not the worst event I've attended", "neutral"),
    ("Middle of the road, nothing exceptional stood out", "neutral"),
    ("May magandang at hindi magandang parte, balanced overall", "neutral"),
    ("Hindi outstanding pero hindi rin disappointing, okay lang", "neutral"),
    ("Could use improvements pero hindi masama ang overall experience", "neutral"),
    ("Moderate lang, some aspects were good others were lacking", "neutral"),
    ("Sana mas mahusay pero ganun talaga minsan, okay lang", "neutral"),
    ("Not bad, not great, somewhere in between siguro", "neutral"),
    ("Kinakaya lang, may positive at negative points naman", "neutral"),
    ("Three out of five, may magagawa pang improvement", "neutral"),
    ("Okay event overall, room for improvement in some areas", "neutral"),
    ("Pasable lang, hindi ako masyadong excited or disappointed", "neutral"),

    # ── Taglish positive ────────────────────────────────────────────────────
    ("The event was so ganda, everyone enjoyed!", "positive"),
    ("Super informative yung speakers, very helpful", "positive"),
    ("Grabe, the organizers did an amazing job talaga", "positive"),
    ("Loved the event! Masaya at very well-organized", "positive"),
    ("So sulit! Great speakers and engaging activities", "positive"),
    ("Amazing event, I highly recommend attending next time!", "positive"),

    # ── Taglish negative ────────────────────────────────────────────────────
    ("The venue was too mainit and cramped, not comfortable", "negative"),
    ("Hindi naman okay yung program flow, magulo", "negative"),
    ("The event started very late, poor time management", "negative"),
    ("Topics were boring and not relevant sa course namin", "negative"),
    ("Disappointed sa speakers, hindi sila prepared", "negative"),
    ("Maayos ang seminar sa AVR, malinaw ang audio at sulit ang discussion", "positive"),
    ("Very organized ang orientation sa campus, mabilis ang registration at helpful ang marshals", "positive"),
    ("Nagustuhan ko yung workshop sa PUPSJ, relevant sa students at engaging ang facilitator", "positive"),
    ("Helpful ang student services booth, accommodating ang staff", "positive"),
    ("Magulo ang pila sa campus event at sobrang init ng hallway", "negative"),
    ("Hindi marinig ang speaker sa covered court, sayang yung talk", "negative"),
    ("Nakakapagod yung event dahil masikip at overcrowded ang venue", "negative"),
    ("Okay naman ang campus activity pero kulang sa chairs at medyo late nagsimula", "neutral"),
    ("Ayos ang program pero masyadong mahaba ang opening remarks", "neutral"),
    ("Pwede na ang event, informative pero may konting technical issues", "neutral"),

    # ── Common short expressions ────────────────────────────────────────────
    ("Napakaganda! Sana maulit!", "positive"),
    ("Magaling sila! Thumbs up!", "positive"),
    ("Very disappointing event.", "negative"),
    ("Could be better, needs improvement.", "negative"),
    ("Okay lang, nothing special.", "neutral"),
    ("Medyo boring pero okay naman.", "neutral"),
]


def _label_from_rating(r: int) -> str:
    if r <= 2: return "negative"
    if r == 3: return "neutral"
    return "positive"


async def fetch_db_feedback() -> list[tuple[str, str]]:
    conn = await asyncpg.connect(DB_URL)
    try:
        rows = await conn.fetch(
            "SELECT rating, comment FROM feedback "
            "WHERE comment IS NOT NULL AND TRIM(comment) != ''"
        )
    finally:
        await conn.close()

    pairs = []
    for r in rows:
        cleaned = preprocess_for_tfidf(r["comment"])
        if len(cleaned.split()) >= 3:
            pairs.append((cleaned, _label_from_rating(int(r["rating"]))))
    return pairs


def train(data: list[tuple[str, str]]) -> None:
    if len(data) < MIN_SAMPLES_FOR_TRAINING:
        print(
            f"Only {len(data)} training samples — need at least "
            f"{MIN_SAMPLES_FOR_TRAINING}.\n"
            "Collect more feedback first or add more synthetic examples."
        )
        return

    X_all, y_all = zip(*data)
    X_all, y_all = list(X_all), list(y_all)
    label_counts = Counter(y_all)

    print(f"\nDataset: {len(X_all)} total samples")
    print(f"Distribution: {dict(label_counts)}")

    # ── Save global TF-IDF (always — used by analyzer.py for term extraction) ─
    global_vec = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=1,          # lower than production min_df=2 to keep synthetic vocab
        max_df=0.95,
        sublinear_tf=True,
        max_features=15_000,
    )
    global_vec.fit(X_all)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(global_vec, GLOBAL_TFIDF_PATH)
    print(f"Global TF-IDF saved — vocab size: {len(global_vec.get_feature_names_out()):,}")

    # ── Sentiment classifier ──────────────────────────────────────────────
    # Combine word n-grams (1,2) + char n-grams (3,5) for better morphological
    # coverage of Filipino verb forms and affixes (mag-, nag-, na-, -ng, etc.)
    can_stratify = all(v >= 2 for v in label_counts.values())
    X_tr, X_te, y_tr, y_te = train_test_split(
        X_all, y_all,
        test_size=0.20,
        random_state=42,
        stratify=y_all if can_stratify else None,
    )

    word_tfidf = TfidfVectorizer(
        analyzer="word",
        ngram_range=(1, 2),
        min_df=1,
        max_df=0.95,
        sublinear_tf=True,
        max_features=8_000,
    )
    char_tfidf = TfidfVectorizer(
        analyzer="char_wb",      # word-boundary char n-grams
        ngram_range=(3, 5),
        min_df=1,
        max_df=0.95,
        sublinear_tf=True,
        max_features=5_000,
    )

    pipeline = Pipeline([
        (
            "features",
            FeatureUnion([
                ("word", word_tfidf),
                ("char", char_tfidf),
            ]),
        ),
        (
            "clf",
            LogisticRegression(
                max_iter=2000,
                class_weight="balanced",
                solver="lbfgs",
                random_state=42,
                C=0.8,
            ),
        ),
    ])

    pipeline.fit(X_tr, y_tr)
    y_pred = pipeline.predict(X_te)

    print("\n=== Held-out test set (20%) ===")
    print(classification_report(y_te, y_pred, zero_division=0))

    labels_sorted = sorted(set(y_all))
    cm = confusion_matrix(y_te, y_pred, labels=labels_sorted)
    print("Confusion matrix (rows=actual, cols=predicted):")
    print(f"labels: {labels_sorted}")
    print(cm)

    if len(X_all) >= 30 and can_stratify:
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(
            pipeline, X_all, y_all, cv=cv, scoring="f1_weighted"
        )
        print(f"\n5-fold CV F1: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # Refit on full data before saving
    pipeline.fit(X_all, y_all)
    joblib.dump(pipeline, SENTIMENT_MODEL_PATH)
    print(f"\nSentiment model saved to {SENTIMENT_MODEL_PATH}")

    accuracy = float(np.mean(np.array(y_pred) == np.array(y_te)))
    print(f"✓ Training complete — test accuracy: {accuracy*100:.1f}%")


async def main():
    print("Fetching feedback from DB…")
    db_data = await fetch_db_feedback()
    print(f"  {len(db_data)} real feedback rows from DB")

    # Preprocess synthetic examples
    synthetic = [
        (preprocess_for_tfidf(text), label)
        for text, label in SYNTHETIC_EXAMPLES
    ]
    print(f"  {len(synthetic)} synthetic training examples")

    # Combine: DB data first (higher weight to real data), then synthetic
    combined = db_data + synthetic
    print(f"  {len(combined)} total training samples")

    train(combined)


if __name__ == "__main__":
    asyncio.run(main())
