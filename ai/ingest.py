"""
PUPSJ Handbook Ingestion Script

Parses the handbook PDF, splits it into overlapping chunks,
stores the text in Postgres, then trains and saves the
TF-IDF retriever model used by the chatbot.

No Ollama or pgvector required — all retrieval is done in-process
by the sklearn HandbookRetriever.

Usage:
  python ai/ingest.py <path_to_handbook.pdf>

Re-run whenever the handbook is updated.
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

# Allow running as a script from the project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ai.ml.retriever import HandbookRetriever  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_URL = (
    f"postgresql://{os.getenv('DB_USER', 'postgres')}:"
    f"{os.getenv('DB_PASSWORD', '1234567')}@"
    f"{os.getenv('DB_HOST', 'localhost')}:"
    f"{os.getenv('DB_PORT', '5432')}/"
    f"{os.getenv('DB_NAME', 'pupsj_hub')}"
)

CHUNK_WORDS   = 120   # smaller = each section stays together
OVERLAP_WORDS = 30    # enough overlap to preserve cross-boundary context
MIN_CHUNK_WORDS = 15  # skip near-empty slivers


def extract_pdf(path: str) -> str:
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz
    doc = fitz.open(path)
    pages = [page.get_text() for page in doc]
    doc.close()
    full_text = "\n".join(pages)
    print(f"  Extracted {len(full_text):,} characters from {len(pages)} pages")
    return full_text


def _is_heading(line: str) -> bool:
    """Detect section headings: ALL-CAPS short lines or Roman-numeral sections."""
    s = line.strip()
    if not s or len(s) > 80:
        return False
    # All uppercase (and at least 3 chars of alpha)
    alpha = [c for c in s if c.isalpha()]
    return len(alpha) >= 3 and s == s.upper()


def make_chunks(text: str) -> list[str]:
    """
    Section-aware chunking:
    1. Split text into lines and detect headings.
    2. Prepend the most recent heading to every chunk so queries like
       "what is the vision?" can match even if 'vision' only appears
       as a heading and not in the body text.
    3. Use word-count windows with overlap inside each section.
    """
    lines = text.splitlines()
    current_heading = ""
    annotated_words: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if _is_heading(stripped):
            # Inject heading as a repeated anchor so BM25/TF-IDF indexes it
            current_heading = stripped
            annotated_words.append(f"[SECTION: {stripped}]")
        else:
            # Prefix EVERY paragraph with its section tag so every chunk
            # can be found by section name, not just the first paragraph.
            if current_heading:
                annotated_words.append(f"[SECTION: {current_heading}]")
            annotated_words.extend(stripped.split())

    # Sliding window over the annotated token stream
    chunks, i = [], 0
    while i < len(annotated_words):
        piece = " ".join(annotated_words[i: i + CHUNK_WORDS])
        if len(piece.split()) >= MIN_CHUNK_WORDS:
            chunks.append(piece)
        i += CHUNK_WORDS - OVERLAP_WORDS

    return chunks


async def store_chunks(chunks: list[str]):
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute("DELETE FROM handbook_chunks")
        await conn.executemany(
            "INSERT INTO handbook_chunks (chunk_text, chunk_index) VALUES ($1, $2)",
            [(chunk, i) for i, chunk in enumerate(chunks)],
        )
        print(f"  Stored {len(chunks)} chunks in handbook_chunks table")
    finally:
        await conn.close()


async def main(pdf_path: str):
    print(f"\n=== PUPSJ Handbook Ingestion ===")
    print(f"Source: {pdf_path}\n")

    # 1. Extract text
    print("[1/3] Extracting text from PDF...")
    text = extract_pdf(pdf_path)

    # 2. Split into chunks
    chunks = make_chunks(text)
    print(f"[1/3] Split into {len(chunks)} chunks "
          f"({CHUNK_WORDS}-word windows, {OVERLAP_WORDS}-word overlap)")

    # 3. Store in DB
    print("\n[2/3] Storing chunks in Postgres...")
    await store_chunks(chunks)

    # 4. Train TF-IDF retriever and save .pkl
    print("\n[3/3] Training TF-IDF retriever...")
    retriever = HandbookRetriever()
    stats = retriever.build_from_chunks(chunks)
    saved_path = retriever.save()
    print(f"  Chunks:    {stats['num_chunks']}")
    print(f"  Vocab:     {stats['vocab_size']:,} terms")
    print(f"  Matrix:    {stats['matrix_shape'][0]} × {stats['matrix_shape'][1]}")
    print(f"  Saved to:  {saved_path}")

    print(f"\nIngestion complete. Restart the AI sidecar to load the new model.")
    print("  uvicorn ai.api:app --port 8000 --reload")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ai/ingest.py <path_to_handbook.pdf>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
