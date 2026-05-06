"""
Train the semantic chatbot retriever for PUPSJ HUB.

What this does
--------------
1. Loads the existing BM25 handbook retriever (built by  ai/ingest.py ).
2. Re-encodes every handbook chunk with the multilingual sentence-transformer
   model  paraphrase-multilingual-MiniLM-L12-v2 .
3. Saves the chunk embeddings to  ai/models/semantic_retriever.pkl .

Once the semantic model is saved, the AI sidecar automatically loads it on
startup and uses it alongside BM25+TF-IDF for hybrid retrieval, giving
dramatically better results for Taglish / paraphrased questions.

Requirements
------------
    pip install sentence-transformers
    (Already added to ai/requirements.txt.)

Usage
-----
    python -m ai.ml.train_chatbot      # from project root
    python ai/ml/train_chatbot.py      # direct run

Notes
-----
- First run downloads ~120 MB model from HuggingFace (one-time).
- Encoding ~1000 handbook chunks takes 30-90 seconds on CPU.
- GPU is NOT required.
- After training, restart the AI sidecar to pick up the new model.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Force UTF-8 output so progress bars and status lines print cleanly on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Allow running from project root or directly from this directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai.ml.retriever import (   # noqa: E402
    HandbookRetriever,
    SemanticRetriever,
    RETRIEVER_PATH,
    SEMANTIC_RETRIEVER_PATH,
)


def _check_sentence_transformers() -> bool:
    try:
        import sentence_transformers  # noqa: F401
        return True
    except ImportError:
        return False


def main() -> None:
    print("=" * 60)
    print("PUPSJ HUB - Semantic Chatbot Trainer")
    print("Model : paraphrase-multilingual-MiniLM-L12-v2")
    print(f"Output: {SEMANTIC_RETRIEVER_PATH}")
    print("=" * 60)

    # ── Dependency check ──────────────────────────────────────────────────
    if not _check_sentence_transformers():
        print("\n[FAIL] sentence-transformers is NOT installed.")
        print("  Run:  pip install sentence-transformers")
        print("  Then re-run this script.")
        sys.exit(1)
    print("\n[OK] sentence-transformers is installed")

    # ── Load handbook chunks from existing BM25 retriever ─────────────────
    print(f"\nLoading handbook retriever from:\n  {RETRIEVER_PATH}")
    bm25_retriever = HandbookRetriever.load()
    if bm25_retriever is None:
        print(
            "\n[FAIL] handbook_retriever.pkl not found.\n"
            "  The handbook has not been ingested yet.\n"
            "  Run:  python ai/ingest.py <your_handbook.pdf>\n"
            "  Then re-run this script."
        )
        sys.exit(1)

    chunks = bm25_retriever.chunks
    print(f"[OK] Loaded {len(chunks):,} handbook chunks")

    # ── Build semantic retriever ───────────────────────────────────────────
    print(
        "\nBuilding semantic embeddings...\n"
        "(First run downloads ~120 MB model - this is normal and happens once)"
    )

    semantic = SemanticRetriever()
    t0 = time.time()
    stats = semantic.build_from_chunks(chunks, show_progress=True)
    elapsed = time.time() - t0

    print(f"\n[OK] Encoding complete in {elapsed:.1f}s")
    print(f"  Chunks        : {stats['num_chunks']:,}")
    print(f"  Embedding dim : {stats['embedding_dim']}")
    print(f"  Model         : {stats['model']}")

    # ── Save ──────────────────────────────────────────────────────────────
    saved_path = semantic.save(SEMANTIC_RETRIEVER_PATH)
    print(f"\n[OK] Saved to: {saved_path}")

    # ── Quick sanity test ─────────────────────────────────────────────────
    print("\nRunning retrieval sanity check (6 test queries)...")
    test_queries = [
        # English handbook questions
        "What are the rules about academic dishonesty?",
        "How many absences are allowed before failing?",
        # Filipino / Taglish questions
        "Ano ang requirements para mag-enroll?",
        "Paano kung lumabag sa code of conduct?",
        # App navigation questions
        "Where can I find the class schedule?",
        "How do I submit feedback for an event?",
    ]

    all_ok = True
    for q in test_queries:
        results = semantic.retrieve(q, top_k=1)
        if results:
            r = results[0]
            snippet = r["text"][:90].replace("\n", " ")
            print(f"\n  [PASS] score={r['similarity']:.3f}  query: {q!r}")
            print(f"         match: {snippet}...")
        else:
            print(f"\n  [MISS] No results for: {q!r}")
            all_ok = False

    print()
    if all_ok:
        print("[OK] All test queries returned results - model looks healthy.")
    else:
        print("[WARN] Some queries returned no results. Check handbook coverage.")

    print(
        "\n--- Training complete ---\n"
        "Restart the AI sidecar to activate the semantic model:\n"
        "  uvicorn ai.api:app --reload\n"
        "The chatbot will now use semantic search + BM25 fusion."
    )


if __name__ == "__main__":
    main()
