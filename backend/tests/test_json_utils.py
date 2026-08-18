"""Unit tests for extract_json — the last line of defence between a model's
prose-wrapped reply and a router that expects structured data."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.json_utils import extract_json  # noqa: E402


def test_parses_bare_json_object():
    assert extract_json('{"a": 1}') == {"a": 1}


def test_parses_bare_json_array():
    assert extract_json('[1, 2, 3]') == [1, 2, 3]


def test_strips_markdown_fence_with_language_tag():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_strips_markdown_fence_without_language_tag():
    assert extract_json('```\n{"a": 1}\n```') == {"a": 1}


def test_ignores_prose_before_a_fence():
    assert extract_json('Here is the result:\n```json\n{"a": 1}\n```') == {"a": 1}


def test_ignores_prose_before_bare_json():
    assert extract_json('Sure! {"a": 1}') == {"a": 1}


def test_ignores_prose_after_json():
    assert extract_json('{"a": 1}\nHope that helps.') == {"a": 1}


def test_keeps_a_string_value_that_starts_with_the_language_tag():
    # `lstrip("json")` would have chewed characters off a real value here.
    assert extract_json('```json\n{"note": "json is fine"}\n```') == {"note": "json is fine"}


def test_does_not_return_a_bare_scalar_found_in_the_prose():
    # "42" parses as valid JSON but is never the structure a caller wants.
    assert extract_json('42 records found:\n{"a": 1}') == {"a": 1}


def test_handles_brackets_inside_string_values():
    text = '{"query": "diabetes AND (insulin OR metformin)", "n": 2}'
    assert extract_json(text) == {"query": "diabetes AND (insulin OR metformin)", "n": 2}


def test_handles_escaped_quotes_inside_string_values():
    text = 'Result: {"title": "A \\"quoted\\" study"}'
    assert extract_json(text) == {"title": 'A "quoted" study'}


def test_handles_nested_structures():
    text = 'Output:\n{"rows": [{"cells": {"Method": "RCT"}}]}'
    assert extract_json(text) == {"rows": [{"cells": {"Method": "RCT"}}]}


def test_picks_whichever_bracket_type_comes_first():
    assert extract_json('note [1,2] then {"a":1}') == [1, 2]
    assert extract_json('note {"a":1} then [1,2]') == {"a": 1}


def test_returns_none_for_empty_input():
    assert extract_json("") is None
    assert extract_json(None) is None


def test_returns_none_when_there_is_no_json():
    assert extract_json("I could not answer that.") is None


def test_returns_none_for_truncated_json():
    assert extract_json('{"a": 1, "b":') is None


def test_long_prose_with_no_json_does_not_blow_up():
    # The previous implementation retried a parse at every end position, which
    # was quadratic; this should stay effectively instant.
    assert extract_json("no json here. " * 5000) is None
