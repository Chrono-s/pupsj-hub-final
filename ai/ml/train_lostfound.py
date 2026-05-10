from __future__ import annotations

from datetime import date, timedelta
import random

import joblib
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

from ai.ml.lostfound_model import MODEL_DIR, MODEL_PATH, build_feature_row

random.seed(42)
DATE_START = date(2026, 1, 1)

ITEM_LIBRARY = [
    {"item_name": "black nike wallet", "category": "Personal Items", "description_bits": ["black", "nike logo", "folding wallet", "small zipper pocket"]},
    {"item_name": "blue aquaflask tumbler", "category": "Personal Items", "description_bits": ["blue", "aquaflask", "metal tumbler", "sticker near the cap"]},
    {"item_name": "white water bottle", "category": "Personal Items", "description_bits": ["white", "water bottle", "plastic bottle", "transparent body"]},
    {"item_name": "brown envelope with papers", "category": "Documents", "description_bits": ["brown envelope", "printed papers", "student documents", "long envelope"]},
    {"item_name": "yellow notebook", "category": "School Supplies", "description_bits": ["yellow", "notebook", "spiral notebook", "name on the cover"]},
    {"item_name": "black umbrella", "category": "Personal Items", "description_bits": ["black", "umbrella", "automatic umbrella", "wooden handle"]},
    {"item_name": "red flash drive", "category": "Electronics", "description_bits": ["red", "usb", "flashdrive", "16gb"]},
    {"item_name": "student id with lace", "category": "Documents", "description_bits": ["student id", "maroon lace", "pup id", "plastic holder"]},
    {"item_name": "gray backpack", "category": "Personal Items", "description_bits": ["gray", "backpack", "jansport", "front pocket"]},
    {"item_name": "clear folder with papers", "category": "Documents", "description_bits": ["clear folder", "papers inside", "plastic folder", "course handouts"]},
]

LOCATIONS = [
    "Room 201", "Library", "Canteen", "Hallway", "Lobby", "Ground floor", "Stairs near registrar",
]

POS_TEMPLATES = [
    "I lost a {item_name} that is {bits}.",
    "Found item appears to be a {item_name}; details: {bits}.",
    "Missing {item_name}, {bits}.",
    "{item_name} with {bits}.",
]

NEG_TEMPLATES = [
    "I lost a {item_name} but it was {bits}.",
    "{item_name} with {bits}.",
]


def render_bits(bits: list[str]) -> str:
    return ", ".join(bits)


def sample_bits(bits: list[str], max_items: int = 3) -> list[str]:
    return random.sample(bits, k=min(max_items, len(bits)))


def random_report_date(start_day: date | None = None, min_offset: int = 0, max_offset: int = 7) -> str:
    anchor = start_day or (DATE_START + timedelta(days=random.randint(0, 120)))
    return (anchor + timedelta(days=random.randint(min_offset, max_offset))).isoformat()


def make_example(base: dict, positive: bool) -> tuple[dict, dict, int]:
    query_bits = sample_bits(base["description_bits"])
    candidate_bits = sample_bits(base["description_bits"])
    base_day = DATE_START + timedelta(days=random.randint(0, 120))

    if positive:
        query = {
            "type": "lost",
            "item_name": base["item_name"],
            "description": random.choice(POS_TEMPLATES).format(item_name=base["item_name"], bits=render_bits(query_bits)),
            "category": base["category"],
            "location_found": random.choice(LOCATIONS),
            "date_reported": random_report_date(base_day, 0, 2),
            "image_fingerprints": [],
        }
        candidate = {
            "id": f"cand-{random.randint(1000, 9999)}",
            "type": "found",
            "item_name": base["item_name"],
            "description": random.choice(POS_TEMPLATES).format(item_name=base["item_name"], bits=render_bits(candidate_bits)),
            "category": base["category"],
            "location_found": random.choice(LOCATIONS),
            "date_reported": random_report_date(base_day, 0, 5),
            "image_fingerprints": [],
        }
        return query, candidate, 1

    same_category_pool = [
        item for item in ITEM_LIBRARY
        if item["item_name"] != base["item_name"] and item["category"] == base["category"]
    ]
    other_pool = same_category_pool if same_category_pool and random.random() < 0.7 else [
        item for item in ITEM_LIBRARY if item["item_name"] != base["item_name"]
    ]
    other = random.choice(other_pool)
    other_bits = sample_bits(other["description_bits"])
    if random.random() < 0.55:
        shared_bit = random.choice(base["description_bits"])
        if shared_bit not in other_bits:
            other_bits[-1] = shared_bit

    query = {
        "type": "lost",
        "item_name": base["item_name"],
        "description": random.choice(NEG_TEMPLATES).format(item_name=base["item_name"], bits=render_bits(query_bits)),
        "category": base["category"],
        "location_found": random.choice(LOCATIONS),
        "date_reported": random_report_date(base_day, 0, 2),
        "image_fingerprints": [],
    }
    candidate = {
        "id": f"cand-{random.randint(1000, 9999)}",
        "type": "found",
        "item_name": other["item_name"],
        "description": random.choice(NEG_TEMPLATES).format(item_name=other["item_name"], bits=render_bits(other_bits)),
        "category": other["category"],
        "location_found": random.choice(LOCATIONS),
        "date_reported": random_report_date(base_day, 0 if same_category_pool and other in same_category_pool else 10, 5 if same_category_pool and other in same_category_pool else 45),
        "image_fingerprints": [],
    }
    return query, candidate, 0


def build_dataset() -> tuple[list[dict], list[int]]:
    rows: list[dict] = []
    labels: list[int] = []
    for item in ITEM_LIBRARY:
        for _ in range(180):
            q, c, y = make_example(item, True)
            rows.append(build_feature_row(q, c))
            labels.append(y)
        for _ in range(240):
            q, c, y = make_example(item, False)
            rows.append(build_feature_row(q, c))
            labels.append(y)
    return rows, labels


def main() -> None:
    rows, labels = build_dataset()
    X_train, X_test, y_train, y_test = train_test_split(
        rows, labels, test_size=0.2, random_state=42, stratify=labels
    )

    vectorizer = DictVectorizer(sparse=True)
    Xtr = vectorizer.fit_transform(X_train)
    Xte = vectorizer.transform(X_test)

    model = LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42)
    model.fit(Xtr, y_train)

    preds = model.predict(Xte)
    print(classification_report(y_test, preds, digits=4))

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"vectorizer": vectorizer, "model": model}, MODEL_PATH)
    print(f"Saved custom lost-found model to {MODEL_PATH}")


if __name__ == "__main__":
    main()
