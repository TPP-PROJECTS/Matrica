"""
Shared JSON extraction utility for all routers.

Models sometimes prefix their JSON with prose, or wrap it in markdown fences.
extract_json() strips fences and finds the first complete {…} or […] block.
"""
import json

_FENCE_LANGUAGES = ("json", "javascript", "js")


def _strip_language_tag(block: str) -> str:
    """Drop a leading ```json / ```js language tag from a fenced block.

    Written as a prefix check rather than `lstrip("json")`, which strips any of
    the characters j, s, o, n from the left and would eat into real content.
    """
    stripped = block.strip()
    for language in _FENCE_LANGUAGES:
        if stripped.lower().startswith(language):
            return stripped[len(language):].strip()
    return stripped


def _scan_balanced(text: str, start: int, opener: str, closer: str) -> dict | list | None:
    """Parse the value beginning at `start` by tracking nesting depth.

    Walking the string once and stopping at the matching close bracket replaces
    a scan that tried every possible end position — quadratic in the length of
    the response, which is slow on the long outputs the matrix step produces.
    String literals are tracked so a bracket inside a value cannot end the scan
    early.
    """
    depth = 0
    in_string = False
    escaped = False

    for i in range(start, len(text)):
        char = text[i]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except (json.JSONDecodeError, ValueError):
                    return None
    return None


def extract_json(text: str) -> dict | list | None:
    """
    Find and parse the first complete JSON object or array in text,
    ignoring surrounding prose and markdown code fences.
    """
    text = (text or "").strip()
    if not text:
        return None

    # Strip markdown fences
    if "```" in text:
        for part in text.split("```"):
            candidate = _strip_language_tag(part)
            if not candidate:
                continue
            try:
                parsed = json.loads(candidate)
            except (json.JSONDecodeError, ValueError):
                continue
            # Prose before the fence can itself be valid JSON ("42", "null"),
            # which is never what the caller is after.
            if isinstance(parsed, (dict, list)):
                return parsed

    # Try direct parse first (fast path)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, (dict, list)):
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass

    # Find the first { or [ and scan forward to its matching bracket.
    candidates = [
        (text.find(opener), opener, closer)
        for opener, closer in (("{", "}"), ("[", "]"))
    ]
    for start, opener, closer in sorted(c for c in candidates if c[0] != -1):
        parsed = _scan_balanced(text, start, opener, closer)
        if parsed is not None:
            return parsed

    return None
