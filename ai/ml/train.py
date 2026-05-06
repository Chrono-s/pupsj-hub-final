"""
Train ML models from accumulated feedback in Postgres.

Outputs (all saved to ai/models/):
  sentiment_model.pkl        — TF-IDF + LogisticRegression pipeline
  global_feedback_tfidf.pkl  — TF-IDF vectorizer fitted on ALL feedback
                               (used by analyzer.py for richer per-event features)

Usage:
  python -m ai.ml.train           # from project root
  python ai/ml/train.py           # direct run

Re-run whenever enough new feedback has been collected.
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
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline

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
MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
SENTIMENT_MODEL_PATH  = MODEL_DIR / "sentiment_model.pkl"
GLOBAL_TFIDF_PATH     = MODEL_DIR / "global_feedback_tfidf.pkl"

MIN_SAMPLES_FOR_TRAINING = 15


def _label(r: int) -> str:
    if r <= 2: return "negative"
    if r == 3: return "neutral"
    return "positive"


async def fetch_feedback() -> list[tuple[str, str]]:
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
        if len(cleaned.split()) >= 3:      # skip very short comments
            pairs.append((cleaned, _label(int(r["rating"]))))
    return pairs


def train(data: list[tuple[str, str]]) -> None:
    if len(data) < MIN_SAMPLES_FOR_TRAINING:
        print(
            f"Only {len(data)} usable feedback rows — need at least "
            f"{MIN_SAMPLES_FOR_TRAINING} to train a reliable model.\n"
            "Collect more student feedback first, then re-run."
        )
        return

    X_all, y_all = zip(*data)
    X_all, y_all = list(X_all), list(y_all)
    label_counts = Counter(y_all)

    print(f"Dataset: {len(X_all)} samples")
    print(f"Distribution: {dict(label_counts)}")

    # ── Save global TF-IDF first (always, regardless of classifier quality) ──
    global_vec = TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
        max_features=15_000,
    )
    global_vec.fit(X_all)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(global_vec, GLOBAL_TFIDF_PATH)
    print(f"\nGlobal TF-IDF saved — vocab size: {len(global_vec.get_feature_names_out()):,}")

    # ── Sentiment classifier ──────────────────────────────────────────────
    can_stratify = min(label_counts.values()) >= 2
    X_tr, X_te, y_tr, y_te = train_test_split(
        X_all, y_all,
        test_size=0.2,
        random_state=42,
        stratify=y_all if can_stratify else None,
    )

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            max_df=0.95,
            sublinear_tf=True,
            max_features=10_000,
        )),
        ("clf", LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
            solver="lbfgs",
            random_state=42,
            C=1.0,
        )),
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

    # Cross-validation if enough samples
    if len(X_all) >= 30 and can_stratify:
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(pipeline, X_all, y_all, cv=cv, scoring="f1_weighted")
        print(f"\n5-fold CV F1: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # Refit on full data before saving
    pipeline.fit(X_all, y_all)
    joblib.dump(pipeline, SENTIMENT_MODEL_PATH)
    print(f"\nSentiment model saved to {SENTIMENT_MODEL_PATH}")

    accuracy = float(np.mean(np.array(y_pred) == np.array(y_te)))
    print(f"\n✓ Training complete — test accuracy: {accuracy*100:.1f}%")


async def main():
    print(f"Fetching feedback from DB...")
    data = await fetch_feedback()
    if not data:
        print("No feedback found. Have any students submitted comments yet?")
        return
    train(data)


if __name__ == "__main__":
    asyncio.run(main())
