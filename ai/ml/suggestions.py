"""
Rule-based suggestion engine.

Maps detected complaint keywords (from the ML analyzer) to actionable
recommendations for event organisers. Each category collects related
English + Tagalog keyword variants so Taglish feedback is covered.
"""

SUGGESTION_CATEGORIES = [
    {
        "category": "timeliness",
        "keywords": [
            "late", "delayed", "delay", "tagal", "matagal", "nahuli",
            "hintay", "waiting", "wait", "oras", "hinintay",
            "start", "nagsimula", "umpisa",
        ],
        "recommendation": (
            "Start the event on time. Build in a 10–15 minute buffer for "
            "setup and clearly communicate the schedule to attendees in advance. "
            "Assign a timekeeper to enforce transitions between segments."
        ),
    },
    {
        "category": "food_refreshments",
        "keywords": [
            "food", "pagkain", "snack", "meryenda", "lunch", "breakfast",
            "dinner", "hungry", "gutom", "drinks", "inumin", "water", "tubig",
        ],
        "recommendation": (
            "Improve food and refreshments. Ensure adequate quantity for the "
            "expected headcount, offer vegetarian/allergy-safe options, and "
            "provide drinking water throughout the event."
        ),
    },
    {
        "category": "venue_comfort",
        "keywords": [
            "hot", "mainit", "init", "warm",
            "cold", "malamig", "lamig",
            "crowded", "siksikan", "masikip", "cramped", "tight",
            "small", "maliit", "space", "room", "venue", "lugar",
            "seats", "upuan", "chair", "standing", "nakatayo",
            "aircon", "air", "ventilation", "hangin",
        ],
        "recommendation": (
            "Secure a more appropriate venue. Match room capacity to expected "
            "attendance, verify working air-conditioning/ventilation, and "
            "confirm enough seating before the event date."
        ),
    },
    {
        "category": "audio_visual",
        "keywords": [
            "mic", "microphone", "sound", "audio", "speaker", "tunog",
            "hear", "marinig", "dinig", "silent", "tahimik",
            "screen", "projector", "slide", "presentation", "lcd",
            "visual", "kita", "nakikita",
        ],
        "recommendation": (
            "Test all AV equipment before the event. Have backup microphones, "
            "verify projector/screen visibility from the back rows, and assign "
            "a tech person to troubleshoot during the event."
        ),
    },
    {
        "category": "organization",
        "keywords": [
            "disorganized", "magulo", "gulo", "confusing", "confused",
            "chaos", "chaotic", "walang", "wala", "unclear",
            "instruction", "direction", "guide", "lost", "ligaw",
            "coordinator", "organizer",
        ],
        "recommendation": (
            "Improve event coordination. Publish a detailed agenda in advance, "
            "brief all volunteers on their roles, place clear signage around "
            "the venue, and designate a single point of contact for questions."
        ),
    },
    {
        "category": "content_engagement",
        "keywords": [
            "boring", "nakakainip", "inip", "monotonous", "dull",
            "interesting", "informative", "engaging", "interactive",
            "speaker", "talker", "presenter", "topic", "content",
            "activity", "game", "participation",
        ],
        "recommendation": (
            "Review speaker selection and session format. Add interactive "
            "elements (Q&A, polls, group activities) to sustain attention and "
            "vet speakers on content quality before confirming them."
        ),
    },
    {
        "category": "duration",
        "keywords": [
            "short", "maikli", "kulang", "mabilis",
            "long", "mahaba", "tagal", "extended", "dragged",
            "break", "pahinga", "rest",
        ],
        "recommendation": (
            "Reassess event length. Match duration to content depth, insert "
            "10-minute breaks every 90 minutes for longer events, and respect "
            "the advertised end time."
        ),
    },
    {
        "category": "registration_logistics",
        "keywords": [
            "registration", "register", "signup", "sign", "rehistro",
            "line", "pila", "queue", "entry", "pasok", "entrance",
            "attendance", "check", "checkin",
        ],
        "recommendation": (
            "Streamline registration. Offer online pre-registration, set up "
            "multiple check-in stations on event day, and assign dedicated "
            "staff to handle walk-ins separately from pre-registered attendees."
        ),
    },
    {
        "category": "communication",
        "keywords": [
            "announce", "announcement", "inform", "information", "update",
            "notice", "email", "message", "notify", "abiso", "wala akong",
            "alam", "alam ko",
        ],
        "recommendation": (
            "Strengthen pre-event communication. Send reminders 1 week and "
            "1 day before the event with venue, schedule, and what-to-bring "
            "details. Use multiple channels (email, SMS, the HUB app)."
        ),
    },
    {
        "category": "safety_crowd",
        "keywords": [
            "safety", "safe", "unsafe", "dangerous", "delikado",
            "security", "guard", "crowded", "stampede", "siksik",
        ],
        "recommendation": (
            "Improve crowd management and safety. Define clear entry/exit "
            "flows, brief security personnel, and set an attendance cap based "
            "on venue capacity."
        ),
    },
]


def _word_matches(catalogue_keyword: str, pool: set[str]) -> bool:
    """
    Flexible matching: exact, stem-in-word, or word-in-stem for longer tokens.
    Examples:
        "delay"  matches pool{"delayed","delaying"}
        "boring" matches pool{"boring","boringness"}
        "hot"    matches pool{"hot"}
    Minimum 3 chars to avoid false positives on tiny words.
    """
    ck = catalogue_keyword.lower()
    if ck in pool:
        return True
    if len(ck) < 3:
        return False
    for w in pool:
        # catalogue keyword is a stem of a pool word
        if len(w) >= len(ck) and w.startswith(ck):
            return True
        # pool word is a stem of the catalogue keyword
        if len(ck) > 4 and len(w) >= 4 and ck.startswith(w):
            return True
    return False


def generate_suggestions(
    complaint_keywords: list[str],
    cluster_keywords: list[list[str]] | None = None,
    max_suggestions: int = 5,
) -> list[dict]:
    """
    Match detected complaint terms against the suggestion catalogue.

    Args:
        complaint_keywords: flat list of top keywords from negative feedback
        cluster_keywords: optional list of keyword-lists (one per KMeans cluster)
        max_suggestions: cap on returned suggestions

    Returns:
        List of {"category", "matched_keywords", "recommendation"} dicts.
    """
    # Pool everything into one lower-case token set for matching
    pool: set[str] = set()
    for kw in complaint_keywords:
        pool.update(kw.lower().split())
    if cluster_keywords:
        for group in cluster_keywords:
            for kw in group:
                pool.update(kw.lower().split())

    results = []
    scored: list[tuple[int, dict]] = []  # (hit_count, entry_dict)
    used_categories: set[str] = set()

    for entry in SUGGESTION_CATEGORIES:
        if entry["category"] in used_categories:
            continue
        hits = [k for k in entry["keywords"] if _word_matches(k, pool)]
        if hits:
            scored.append((len(hits), {
                "category": entry["category"],
                "matched_keywords": hits[:5],
                "recommendation": entry["recommendation"],
            }))
            used_categories.add(entry["category"])

    # Sort by hit count so the most-matched category appears first
    scored.sort(key=lambda x: x[0], reverse=True)
    results = [item for _, item in scored[:max_suggestions]]

    # Fallback when no category matched — surface raw top complaints
    if not results and complaint_keywords:
        # Only include keywords that are ASCII/Latin (avoid leaking raw Tagalog tokens)
        safe_kws = [k for k in complaint_keywords[:5] if k.isascii()][:5] or complaint_keywords[:3]
        results.append({
            "category": "general",
            "matched_keywords": safe_kws,
            "recommendation": (
                "Attendees raised concerns that were not covered by standard categories. "
                "Review the negative feedback comments directly and discuss improvement "
                "areas with your organizing team before the next event."
            ),
        })

    return results
