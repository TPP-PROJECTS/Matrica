"""Unit tests for the topic ↔ system link parser.

The model call is not exercised; what is tested is the guard around its answer,
because a link naming an id nobody sent is a line the UI cannot draw.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.systems import parse_links  # noqa: E402

TOPICS = {"t1", "t2"}
SYSTEMS = {"sys-1", "sys-2"}


def test_keeps_links_that_name_real_ids():
    links = parse_links(
        {"links": [{"systemId": "sys-1", "topicId": "t1", "strength": "strong", "reason": "Deployed in ED triage."}]},
        TOPICS, SYSTEMS,
    )
    assert len(links) == 1
    assert links[0].systemId == "sys-1"
    assert links[0].topicId == "t1"
    assert links[0].strength == "strong"
    assert links[0].reason == "Deployed in ED triage."


def test_drops_links_to_unknown_ids():
    links = parse_links(
        {"links": [
            {"systemId": "sys-9", "topicId": "t1", "strength": "strong", "reason": "x"},
            {"systemId": "sys-1", "topicId": "t9", "strength": "strong", "reason": "x"},
        ]},
        TOPICS, SYSTEMS,
    )
    assert links == []


def test_drops_a_repeated_pair():
    links = parse_links(
        {"links": [
            {"systemId": "sys-1", "topicId": "t1", "strength": "strong", "reason": "first"},
            {"systemId": "sys-1", "topicId": "t1", "strength": "possible", "reason": "again"},
        ]},
        TOPICS, SYSTEMS,
    )
    assert len(links) == 1
    assert links[0].reason == "first"


def test_unknown_strength_falls_back_to_possible():
    links = parse_links(
        {"links": [{"systemId": "sys-2", "topicId": "t2", "strength": "certain", "reason": "x"}]},
        TOPICS, SYSTEMS,
    )
    assert links[0].strength == "possible"


def test_missing_and_malformed_entries_are_ignored():
    links = parse_links({"links": ["nonsense", {}, None]}, TOPICS, SYSTEMS)
    assert links == []


def test_no_links_key_is_an_empty_answer():
    assert parse_links({}, TOPICS, SYSTEMS) == []
