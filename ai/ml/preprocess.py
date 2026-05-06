"""
Text preprocessing for Taglish (Tagalog + English) campus feedback and queries.

Handles:
- Lowercasing, punctuation, digit removal
- Repeated character normalization ("sooooo" → "so")
- Common abbreviation expansion (English + Filipino campus terms)
- Filipino verb-prefix stripping (mag-, nag-, nakaka-)
- Bilingual stopword filtering
- Negation preservation ("not good", "hindi okay" kept intact)
"""

import re

# ── Abbreviation / typo expansion ────────────────────────────────────────────
# Longer phrases first so they match before substrings do.
ABBREVIATIONS: dict[str, str] = {
    # Campus-specific
    "mag-enroll": "enroll",
    "mag-reg":    "registration",
    "mag-apply":  "apply",
    "nag-enroll": "enrolled",
    "nag-reg":    "registered",
    "mag-bayad":  "payment",
    "mag-print":  "print",
    "enrl":       "enrollment",
    "enrollemnt": "enrollment",
    "enrolment":  "enrollment",
    "dept":       "department",
    "subj":       "subject",
    "sched":      "schedule",
    "schd":       "schedule",
    "prof":       "professor",
    "profie":     "professor",
    "univ":       "university",
    "sch":        "school",
    "org":        "organization",
    "osa":        "office of student affairs",
    "sis":        "student information system",
    "gwa":        "general weighted average",
    "pup":        "polytechnic university",
    "pupsj":      "polytechnic university san juan",
    # General English abbreviations
    "pls":  "please",
    "plz":  "please",
    "thx":  "thanks",
    "thnks":"thanks",
    "abt":  "about",
    "w/":   "with",
    "w/o":  "without",
    "b/w":  "between",
    "asap": "as soon as possible",
    "fyi":  "for your information",
    "btw":  "by the way",
    "imo":  "in my opinion",
    "imho": "in my honest opinion",
    "idk":  "i dont know",
    "tbh":  "to be honest",
    # Filipino casual text
    "2x":   "twice",
    "3x":   "three times",
    "yun":  "that",
    "yung": "the",
    "lang": "only",
    "naman":"also",
    "kasi": "because",
    "kaya": "so",
    "pero": "but",
    "paano":"how",
    "saan": "where",
    "kailan":"when",
}

# ── Stopwords ─────────────────────────────────────────────────────────────────
# Negations intentionally NOT in here so "not good" ≠ "good".
ENGLISH_STOPWORDS: set[str] = {
    "the","a","an","and","or","but","if","then","else","when","where","why",
    "how","what","which","who","whom","is","are","was","were","be","been",
    "being","have","has","had","having","do","does","did","doing","will",
    "would","should","could","may","might","must","can","shall","i","you",
    "he","she","it","we","they","me","him","her","us","them","my","your",
    "his","its","our","their","mine","yours","ours","theirs","this","that",
    "these","those","am","so","also","just","even","than","because","with",
    "without","for","from","by","on","in","at","of","to","as","up","down",
    "out","over","under","again","further","only","same","there","here",
    "some","any","all","each","every","other","another","very","too","quite",
    "really","already","still","yet","much","many","more","most","such",
    "both","either","neither","about","above","after","before","between",
    "during","since","through","throughout","upon","within","along","among",
}

TAGALOG_STOPWORDS: set[str] = {
    "ang","ng","mga","sa","at","ay","na","pa","po","opo",
    "para","kay","kasi","dahil","pero","kung","kaya",
    "ito","iyan","iyon","yan","yun","yung",
    "dito","diyan","doon",
    "ako","ikaw","siya","kami","tayo","kayo","sila",
    "ko","mo","niya","namin","natin","ninyo","nila",
    "akin","iyo","kaniya","amin","atin","inyo","kanila",
    "ganito","ganyan","ganoon",
    "naman","ba","daw","raw","rin","din","lang","lamang",
    "saka","tapos","uy","eh","ah","oh","hay","uhm",
    "kuya","ate","sir","maam","ma'am",
    "oo","ooh","opo","yes","yeah","yep",
    "na","nga","nga","ha","haha","hehe","lol",
}

STOPWORDS: set[str] = ENGLISH_STOPWORDS | TAGALOG_STOPWORDS

# ── Regex patterns ────────────────────────────────────────────────────────────
_RE_URL       = re.compile(r"https?://\S+|www\.\S+")
_RE_MENTION   = re.compile(r"@\w+")
_RE_HASHTAG   = re.compile(r"#\w+")
_RE_PUNCT     = re.compile(r"[^\w\s]")
_RE_DIGIT     = re.compile(r"\d+")
_RE_REPEAT    = re.compile(r"(.)\1{2,}")          # "soooo" → "so"
_RE_MAG       = re.compile(r"\b(mag|nag|makaka|nakaka|makakakuha|naka)-?")
_RE_WHITESPACE= re.compile(r"\s+")


def _expand_abbreviations(text: str) -> str:
    for abbr, full in ABBREVIATIONS.items():
        # Word-boundary safe replacement
        text = re.sub(r"(?<!\w)" + re.escape(abbr) + r"(?!\w)", full, text)
    return text


def clean_text(text: str) -> str:
    """
    Full pipeline: lowercase → expand abbreviations → strip noise →
    normalize repeats → strip Filipino verb prefixes → collapse whitespace.
    """
    if not text:
        return ""
    text = text.lower()
    text = _RE_URL.sub(" ", text)
    text = _RE_MENTION.sub(" ", text)
    text = _RE_HASHTAG.sub(" ", text)
    text = _expand_abbreviations(text)
    text = _RE_PUNCT.sub(" ", text)
    text = _RE_DIGIT.sub(" ", text)
    text = _RE_REPEAT.sub(r"\1\1", text)   # cap repeats at 2
    text = _RE_MAG.sub(" ", text)          # strip mag-/nag- verb prefixes
    text = _RE_WHITESPACE.sub(" ", text).strip()
    return text


def tokenize(text: str) -> list[str]:
    """Tokenise cleaned text, dropping stopwords and single-char tokens."""
    return [
        t for t in clean_text(text).split()
        if len(t) > 1 and t not in STOPWORDS
    ]


def preprocess_for_tfidf(text: str) -> str:
    """Return a cleaned string ready for sklearn/BM25 vectorisers."""
    return " ".join(tokenize(text))
