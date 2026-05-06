from __future__ import annotations

import random

import joblib
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

from ai.ml.lostfound_model import MODEL_DIR, MODEL_PATH, build_feature_row

random.seed(42)

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


def make_example(base: dict, positive: bool) -> tuple[dict, dict, int]:
    query_bits = random.sample(base["description_bits"], k=min(3, len(base["description_bits"])))
    candidate_bits = random.sample(base["description_bits"], k=min(3, len(base["description_bits"])))

    if positive:
        query = {
            "item_name": base["item_name"],
            "description": random.choice(POS_TEMPLATES).format(item_name=base["item_name"], bits=render_bits(query_bits)),
            "category": base["category"],
            "location_found": random.choice(LOCATIONS),
            "image_fingerprints": [],
        }
        candidate = {
            "id": f"cand-{random.randint(1000, 9999)}",
            "item_name": base["item_name"],
            "description": random.choice(POS_TEMPLATES).format(item_name=base["item_name"], bits=render_bits(candidate_bits)),
            "category": base["category"],
            "location_found": random.choice(LOCATIONS),
            "image_fingerprints": [],
        }
        return query, candidate, 1

    other = random.choice([item for item in ITEM_LIBRARY if item["item_name"] != base["item_name"]])
    query = {
        "item_name": base["item_name"],
        "description": random.choice(NEG_TEMPLATES).format(item_name=base["item_name"], bits=render_bits(query_bits)),
        "category": base["category"],
        "location_found": random.choice(LOCATIONS),
        "image_fingerprints": [],
    }
    candidate = {
        "id": f"cand-{random.randint(1000, 9999)}",
        "item_name": other["item_name"],
        "description": random.choice(NEG_TEMPLATES).format(item_name=other["item_name"], bits=render_bits(random.sample(other["description_bits"], k=min(3, len(other["description_bits"]))))),
        "category": other["category"],
        "location_found": random.choice(LOCATIONS),
        "image_fingerprints": [],
    }
    return query, candidate, 0


def build_dataset() -> tuple[list[dict], list[int]]:
    rows: list[dict] = []
    labels: list[int] = []
    for item in ITEM_LIBRARY:
        for _ in range(140):
            q, c, y = make_example(item, True)
            rows.append(build_feature_row(q, c))
            labels.append(y)
        for _ in range(180):
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
