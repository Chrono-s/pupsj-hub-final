from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any
import json

import joblib
import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_PATH = MODEL_DIR / "lostfound_matcher.pkl"

STOPWORDS = {
    "a", "an", "and", "ang", "at", "bag", "for", "from", "i", "in", "is", "it",
    "ko", "my", "na", "ng", "of", "on", "sa", "the", "this", "to", "with",
}
COLORS = {
    "black", "white", "gray", "grey", "silver", "gold", "blue", "red", "green",
    "yellow", "orange", "pink", "purple", "brown", "beige", "maroon",
}
BRANDS = {
    "nike", "adidas", "puma", "jansport", "apple", "samsung", "huawei", "oppo",
    "vivo", "realme", "asus", "acer", "dell", "hp", "lenovo", "aquaflask",
    "hydroflask", "tiger", "tupperware",
}
ITEM_TYPES = {
    "tumbler", "bottle", "wallet", "paper", "document", "folder", "envelope",
    "notebook", "id", "card", "umbrella", "flashdrive", "usb", "phone", "charger",
    "bag", "backpack", "pencilcase", "eyeglasses", "keys", "key", "jacket",
}


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def normalize_text(value: str) -> str:
    return " ".join(
        value.lower()
        .replace("/", " ")
        .replace("-", " ")
        .replace(",", " ")
        .replace(".", " ")
        .split()
    )


def singularize(token: str) -> str:
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith("s") and len(token) > 3 and not token.endswith("ss"):
        return token[:-1]
    return token


def tokenize(value: str) -> list[str]:
    return [
        singularize(token)
        for token in normalize_text(value).split()
        if len(token) > 1 and token not in STOPWORDS
    ]


def overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    denom = max(len(left), len(right))
    if denom == 0:
        return 0.0
    return len(left & right) / denom


def coverage(left: set[str], right: set[str]) -> float:
    if not left:
        return 0.0
    if len(left) == 0:
        return 0.0
    return len(left & right) / len(left)


def mismatch(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return 1.0 if left.isdisjoint(right) else 0.0


def parse_fingerprint(raw: str) -> dict[str, Any]:
    raw = (raw or "").strip()
    if not raw:
        return {}
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def hex_to_bits(value: str) -> str:
    if not value:
        return ""
    try:
        return "".join(bin(int(char, 16))[2:].zfill(4) for char in value)
    except (ValueError, TypeError):
        return ""


def hamming_similarity(left: str, right: str) -> float:
    left_bits = hex_to_bits(left)
    right_bits = hex_to_bits(right)
    if not left_bits or not right_bits or len(left_bits) != len(right_bits) or len(left_bits) == 0:
        return 0.0
    diff = sum(1 for a, b in zip(left_bits, right_bits) if a != b)
    return 1.0 - (diff / len(left_bits))


def image_similarity(query_fingerprints: list[str], candidate_fingerprints: list[str]) -> float:
    best = 0.0
    for q in query_fingerprints:
        qd = parse_fingerprint(q)
        for c in candidate_fingerprints:
            cd = parse_fingerprint(c)
            score_parts: list[float] = []
            if qd.get("ahash") and cd.get("ahash"):
                score_parts.append(hamming_similarity(qd["ahash"], cd["ahash"]))
            if qd.get("dhash") and cd.get("dhash"):
                score_parts.append(hamming_similarity(qd["dhash"], cd["dhash"]))
            if qd.get("rgbMean") and cd.get("rgbMean"):
                q_rgb = np.array(qd["rgbMean"], dtype=float)
                c_rgb = np.array(cd["rgbMean"], dtype=float)
                rgb_score = max(0.0, 1.0 - (np.abs(q_rgb - c_rgb).mean() / 255.0))
                score_parts.append(float(rgb_score))
            if score_parts:
                best = max(best, float(sum(score_parts) / len(score_parts)))
    return best


def build_feature_row(query: dict[str, Any], candidate: dict[str, Any]) -> dict[str, float]:
    query_text = " ".join(filter(None, [
        str(query.get("item_name") or ""),
        str(query.get("description") or ""),
        str(query.get("category") or ""),
        str(query.get("location_found") or ""),
    ]))
    candidate_text = " ".join(filter(None, [
        str(candidate.get("item_name") or ""),
        str(candidate.get("description") or ""),
        str(candidate.get("category") or ""),
        str(candidate.get("location_found") or ""),
    ]))

    query_tokens = set(tokenize(query_text))
    candidate_tokens = set(tokenize(candidate_text))
    query_name = set(tokenize(str(query.get("item_name") or "")))
    candidate_name = set(tokenize(str(candidate.get("item_name") or "")))
    query_colors = query_tokens & COLORS
    candidate_colors = candidate_tokens & COLORS
    query_brands = query_tokens & BRANDS
    candidate_brands = candidate_tokens & BRANDS
    query_types = query_tokens & ITEM_TYPES
    candidate_types = candidate_tokens & ITEM_TYPES
    query_codes = {token for token in query_tokens if any(ch.isdigit() for ch in token)}
    candidate_codes = {token for token in candidate_tokens if any(ch.isdigit() for ch in token)}
    query_date = parse_date(query.get("date_reported"))
    candidate_date = parse_date(candidate.get("date_reported"))
    days_apart = None
    if query_date and candidate_date:
        days_apart = abs((query_date - candidate_date).days)

    qfps = list(query.get("image_fingerprints") or [])
    cfps = list(candidate.get("image_fingerprints") or [])

    return {
        "token_overlap": overlap(query_tokens, candidate_tokens),
        "token_coverage": coverage(query_tokens, candidate_tokens),
        "name_overlap": overlap(query_name, candidate_name),
        "name_coverage": coverage(query_name, candidate_name),
        "color_overlap": overlap(query_colors, candidate_colors),
        "color_mismatch": mismatch(query_colors, candidate_colors),
        "brand_overlap": overlap(query_brands, candidate_brands),
        "brand_mismatch": mismatch(query_brands, candidate_brands),
        "type_overlap": overlap(query_types, candidate_types),
        "type_mismatch": mismatch(query_types, candidate_types),
        "code_overlap": overlap(query_codes, candidate_codes),
        "exact_code_match": 1.0 if query_codes and candidate_codes and not query_codes.isdisjoint(candidate_codes) else 0.0,
        "code_mismatch": mismatch(query_codes, candidate_codes),
        "same_category": 1.0 if normalize_text(str(query.get("category") or "")) == normalize_text(str(candidate.get("category") or "")) and query.get("category") and candidate.get("category") else 0.0,
        "same_location_word": overlap(set(tokenize(str(query.get("location_found") or ""))), set(tokenize(str(candidate.get("location_found") or "")))),
        "image_similarity": image_similarity(qfps, cfps),
        "report_date_gap": max(0.0, 1.0 - (min(days_apart, 30) / 30.0)) if days_apart is not None else 0.0,
        "has_query_fingerprint": 1.0 if qfps else 0.0,
        "has_candidate_fingerprint": 1.0 if cfps else 0.0,
        "valid_type_pair": 1.0 if query.get("type") and candidate.get("type") and str(query.get("type")).strip().lower() != str(candidate.get("type")).strip().lower() else 0.0,
        "query_len": min(len(query_tokens), 20) / 20.0,
        "candidate_len": min(len(candidate_tokens), 20) / 20.0,
    }


@dataclass
class LostFoundMatcherModel:
    bundle: Any

    @classmethod
    def load(cls) -> "LostFoundMatcherModel | None":
        if not MODEL_PATH.exists():
            return None
        try:
            bundle = joblib.load(MODEL_PATH)
            return cls(bundle=bundle)
        except Exception:
            return None

    def predict_scores(self, query: dict[str, Any], candidates: list[dict[str, Any]]) -> list[dict[str, float | str]]:
        if not candidates:
            return []
        rows = [build_feature_row(query, candidate) for candidate in candidates]
        vectorizer = self.bundle["vectorizer"]
        model = self.bundle["model"]
        X = vectorizer.transform(rows)
        probs = model.predict_proba(X)[:, 1]
        return [
            {"id": str(candidate["id"]), "ml_score": round(float(prob), 4)}
            for candidate, prob in zip(candidates, probs)
        ]
