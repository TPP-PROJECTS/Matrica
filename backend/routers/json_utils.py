"""
Shared JSON extraction utility for all routers.

Models sometimes prefix their JSON with prose, or wrap it in markdown fences.
extract_json() strips fences and finds the first complete {…} or […] block.
"""
import json


def extract_json(text: str) -> dict | list | None:
    """
    Find and parse the first complete JSON object or array in text,
    ignoring surrounding prose and markdown code fences.
    """
    text = (text or "").strip()

    # Strip markdown fences
    if "```" in text:
        for part in text.split("```"):
            candidate = part.strip().lstrip("json").strip()
            try:
                return json.loads(candidate)
            except (json.JSONDecodeError, ValueError):
                continue

    # Try direct parse first (fast path)
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    # Find the first { or [ and scan forward for a valid JSON value
    for opener, closer in [('{', '}'), ('[', ']')]:
        start = text.find(opener)
        if start == -1:
            continue
        for end in range(len(text), start, -1):
            if text[end - 1] == closer:
                try:
                    return json.loads(text[start:end])
                except (json.JSONDecodeError, ValueError):
                    continue

    return None
