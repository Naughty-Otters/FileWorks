"""Target languages for Markdown translation post-process."""

from __future__ import annotations

SKIP_LANG_IDS = {"", "original", "none", "off", "source", "keep"}

# id, English label
LANGUAGES: tuple[tuple[str, str], ...] = (
    ("original", "Original (no translation)"),
    ("en", "English"),
    ("zh", "Chinese (Simplified)"),
    ("zh-TW", "Chinese (Traditional)"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("fr", "French"),
    ("de", "German"),
    ("es", "Spanish"),
    ("pt", "Portuguese"),
    ("it", "Italian"),
    ("ru", "Russian"),
    ("ar", "Arabic"),
    ("hi", "Hindi"),
    ("vi", "Vietnamese"),
    ("th", "Thai"),
    ("id", "Indonesian"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("tr", "Turkish"),
)


def normalize_target_lang(value: str | None) -> str:
    lang = (value or "").strip()
    if lang.lower() in SKIP_LANG_IDS:
        return ""
    known = {item[0].lower(): item[0] for item in LANGUAGES if item[0] != "original"}
    return known.get(lang.lower(), lang)


def language_label(lang_id: str) -> str:
    for item_id, label in LANGUAGES:
        if item_id.lower() == lang_id.lower():
            return label
    return lang_id


def language_catalog() -> list[dict[str, str]]:
    return [{"id": item_id, "label": label} for item_id, label in LANGUAGES]
