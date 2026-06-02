"""
Handbook retrievers — two complementary approaches:

  HandbookRetriever  — BM25 + TF-IDF with Reciprocal Rank Fusion.
    BM25  → exact keyword matches, handles term-frequency saturation.
    TF-IDF → cosine similarity, handles partial overlap and IDF weighting.
    RRF   → fuses both rank lists; neither dominates.
    Best for exact terminology matches (Filipino/English).

  SemanticRetriever  — Sentence-Transformer neural embeddings.
    Model : paraphrase-multilingual-MiniLM-L12-v2 (~120 MB, CPU-only).
    Understands Filipino, Taglish, and English natively (multilingual).
    Finds semantically similar content even when the keywords differ.
    Best for paraphrased or conceptual queries.

When both are available, api.py fuses their rank lists with RRF for
state-of-the-art retrieval that beats either method alone.

Run  python -m ai.ml.train_chatbot  to build the semantic model.
Run  python ai/ingest.py <handbook.pdf>  to rebuild the BM25 model.
"""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .preprocess import preprocess_for_tfidf

MODEL_DIR      = Path(__file__).resolve().parent.parent / "models"
RETRIEVER_PATH = MODEL_DIR / "handbook_retriever.pkl"
SEMANTIC_RETRIEVER_PATH = MODEL_DIR / "semantic_retriever.pkl"

# Default sentence-transformers model — multilingual, ~120 MB, CPU-friendly
# Supports Filipino/Tagalog natively; fast enough for real-time queries.
SEMANTIC_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

RRF_K            = 60    # RRF constant — higher = smoother rank fusion
SIMILARITY_FLOOR = 0.05  # below this combined score → not returned


class HandbookRetriever:
    """BM25 + TF-IDF hybrid retriever over handbook text chunks."""

    def __init__(self) -> None:
        self.tfidf_vectorizer: TfidfVectorizer | None = None
        self.tfidf_matrix     = None
        self.bm25: BM25Okapi | None = None
        self.tokenized_chunks: list[list[str]] = []
        self.chunks: list[str] = []

    # ── Training ──────────────────────────────────────────────────────────
    def build_from_chunks(self, chunks: list[str]) -> dict:
        if not chunks:
            raise ValueError("No chunks to index.")

        self.chunks = list(chunks)
        cleaned     = [preprocess_for_tfidf(c) for c in self.chunks]

        # TF-IDF (unigrams + bigrams, sublinear TF for large docs)
        self.tfidf_vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            max_df=0.95,
            max_features=30_000,
            sublinear_tf=True,
        )
        self.tfidf_matrix = self.tfidf_vectorizer.fit_transform(cleaned)

        # BM25 (needs pre-tokenised lists)
        self.tokenized_chunks = [c.split() for c in cleaned]
        self.bm25 = BM25Okapi(self.tokenized_chunks)

        return {
            "num_chunks":   len(self.chunks),
            "vocab_size":   len(self.tfidf_vectorizer.get_feature_names_out()),
            "matrix_shape": tuple(self.tfidf_matrix.shape),
            "retriever":    "BM25 + TF-IDF hybrid (RRF fusion)",
        }

    # ── Inference ─────────────────────────────────────────────────────────
    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        if not self.bm25 or self.tfidf_matrix is None:
            return []

        cleaned_q = preprocess_for_tfidf(query)
        if not cleaned_q.strip():
            return []

        tokens_q = cleaned_q.split()

        # ── BM25 scores (already length-normalised inside BM25Okapi) ──────
        bm25_raw = np.array(self.bm25.get_scores(tokens_q), dtype=float)
        bm25_max = bm25_raw.max()
        bm25_norm = bm25_raw / bm25_max if bm25_max > 0 else bm25_raw

        # ── TF-IDF cosine scores ──────────────────────────────────────────
        q_vec      = self.tfidf_vectorizer.transform([cleaned_q])
        tfidf_norm = cosine_similarity(q_vec, self.tfidf_matrix).ravel()

        # ── Reciprocal Rank Fusion ────────────────────────────────────────
        # Rank arrays (1 = best); argsort of argsort gives rank positions
        tfidf_ranks = np.argsort(np.argsort(-tfidf_norm)) + 1
        bm25_ranks  = np.argsort(np.argsort(-bm25_norm))  + 1
        rrf_scores  = 1.0 / (RRF_K + tfidf_ranks) + 1.0 / (RRF_K + bm25_ranks)

        top_idx = rrf_scores.argsort()[::-1][:top_k]

        results = []
        for i in top_idx:
            combined = (float(tfidf_norm[i]) + float(bm25_norm[i])) / 2.0
            if combined < SIMILARITY_FLOOR:
                continue
            results.append({
                "chunk_index":  int(i),
                "similarity":   round(combined, 4),
                "tfidf_score":  round(float(tfidf_norm[i]), 4),
                "bm25_score":   round(float(bm25_norm[i]), 4),
                "rrf_score":    round(float(rrf_scores[i]), 6),
                "text":         self.chunks[i],
            })
        return results

    # ── Section retrieval ─────────────────────────────────────────────────
    def retrieve_section(self, query: str, broad_top_k: int = 25) -> tuple[list[dict], bool]:
        """
        For broad queries ("everything about X"), retrieve a larger pool of
        chunks and return them sorted in document order so Gemini sees the
        content as a coherent, flowing section rather than scattered snippets.

        Uses broad_top_k=25 to capture multi-sub-section content
        (e.g., Code of Discipline spans CODE OF DISCIPLINE +
        DISCIPLINARY SANCTIONS + several sub-headings).

        Returns (results, True) — always signals broad mode so the prompt
        instructs Gemini to be comprehensive.
        """
        results = self.retrieve(query, top_k=broad_top_k)
        if not results:
            return [], False

        # Sort by chunk index (document order) so Gemini reads them
        # in the same sequence they appear in the handbook
        results_sorted = sorted(results, key=lambda r: r["chunk_index"])
        return results_sorted, True

    # ── Persistence ───────────────────────────────────────────────────────
    def save(self, path: Path = RETRIEVER_PATH) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "tfidf_vectorizer": self.tfidf_vectorizer,
                "tfidf_matrix":     self.tfidf_matrix,
                "bm25":             self.bm25,
                "tokenized_chunks": self.tokenized_chunks,
                "chunks":           self.chunks,
            },
            path,
            compress=3,
        )
        return path

    @classmethod
    def load(cls, path: Path = RETRIEVER_PATH) -> "HandbookRetriever | None":
        if not path.exists():
            return None
        data = joblib.load(path)
        inst = cls()
        inst.tfidf_vectorizer  = data["tfidf_vectorizer"]
        inst.tfidf_matrix      = data["tfidf_matrix"]
        inst.bm25              = data["bm25"]
        inst.tokenized_chunks  = data["tokenized_chunks"]
        inst.chunks            = data["chunks"]
        return inst


# ═══════════════════════════════════════════════════════════════════════════════
# SemanticRetriever — neural dense retrieval via sentence-transformers
# ═══════════════════════════════════════════════════════════════════════════════

class SemanticRetriever:
    """
    Dense retriever using sentence-transformers embeddings.

    Uses  paraphrase-multilingual-MiniLM-L12-v2  by default:
      • ~120 MB model (downloaded once, cached by HuggingFace hub)
      • Runs on CPU — no GPU required
      • Supports Filipino, Tagalog, Taglish, and English natively
      • 384-dimensional embeddings, cosine similarity search

    Build:  python -m ai.ml.train_chatbot
    Then re-start the AI sidecar — it loads automatically.
    """

    def __init__(self) -> None:
        self.model       = None          # SentenceTransformer (loaded lazily)
        self.embeddings: np.ndarray | None = None  # (n_chunks, 384) float32
        self.chunks: list[str] = []
        self.model_name: str  = SEMANTIC_MODEL_NAME

    # ── Training ──────────────────────────────────────────────────────────
    def build_from_chunks(
        self,
        chunks: list[str],
        show_progress: bool = True,
    ) -> dict:
        """Encode all chunks and store normalised embeddings for dot-product search."""
        from sentence_transformers import SentenceTransformer  # lazy import

        self.chunks = list(chunks)
        self.model  = SentenceTransformer(self.model_name)

        print(f"[SemanticRetriever] Encoding {len(self.chunks)} chunks "
              f"with {self.model_name}…")
        self.embeddings = self.model.encode(
            self.chunks,
            batch_size=32,
            show_progress_bar=show_progress,
            normalize_embeddings=True,   # L2-normalise → dot product = cosine sim
            convert_to_numpy=True,
        ).astype(np.float32)

        return {
            "num_chunks":    len(self.chunks),
            "embedding_dim": int(self.embeddings.shape[1]),
            "model":         self.model_name,
            "retriever":     "SemanticRetriever (sentence-transformers)",
        }

    # ── Inference ─────────────────────────────────────────────────────────
    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        """
        Encode query and return top-k chunks by cosine similarity.
        Embeddings are L2-normalised so cosine sim == dot product.
        """
        if self.embeddings is None or self.model is None:
            return []

        q_emb = self.model.encode(
            [query],
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(np.float32)

        # Matrix-vector dot product → cosine similarities
        scores = (self.embeddings @ q_emb.T).ravel()

        top_idx = scores.argsort()[::-1][:top_k]

        results = []
        for i in top_idx:
            sim = float(scores[i])
            if sim < 0.15:   # semantic floor — below this is noise
                continue
            results.append({
                "chunk_index": int(i),
                "similarity":  round(sim, 4),
                "text":        self.chunks[i],
            })
        return results

    def retrieve_section(
        self,
        query: str,
        broad_top_k: int = 25,
    ) -> tuple[list[dict], bool]:
        """
        Broad retrieval sorted by document order (mirrors HandbookRetriever API).
        Returns (results, True).
        """
        results = self.retrieve(query, top_k=broad_top_k)
        if not results:
            return [], False
        results_sorted = sorted(results, key=lambda r: r["chunk_index"])
        return results_sorted, True

    # ── Persistence ───────────────────────────────────────────────────────
    def save(self, path: Path = SEMANTIC_RETRIEVER_PATH) -> Path:
        """
        Save embeddings + chunk texts (NOT the model weights — they live in
        the HuggingFace cache and are reloaded from there on next startup).
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "embeddings": self.embeddings,
                "chunks":     self.chunks,
                "model_name": self.model_name,
            },
            path,
            compress=3,
        )
        return path

    @classmethod
    def load(cls, path: Path = SEMANTIC_RETRIEVER_PATH) -> "SemanticRetriever | None":
        """
        Load pre-computed embeddings and initialise the sentence-transformer model.
        Returns None if the model file doesn't exist or sentence-transformers is
        not installed (allows the system to degrade gracefully to BM25-only).
        """
        if not path.exists():
            return None
        try:
            from sentence_transformers import SentenceTransformer  # noqa: F401
        except ImportError:
            print(
                "[SemanticRetriever] sentence-transformers not installed — "
                "falling back to BM25+TF-IDF only.\n"
                "  Install: pip install sentence-transformers"
            )
            return None

        data = joblib.load(path)
        inst = cls()
        inst.embeddings  = data["embeddings"]
        inst.chunks      = data["chunks"]
        inst.model_name  = data.get("model_name", SEMANTIC_MODEL_NAME)

        try:
            from sentence_transformers import SentenceTransformer
            inst.model = SentenceTransformer(inst.model_name)
            return inst
        except Exception as e:
            print(
                f"[SemanticRetriever] Failed to load SentenceTransformer model '{inst.model_name}' "
                f"({type(e).__name__}: {e}) — falling back to BM25+TF-IDF only."
            )
            return None

