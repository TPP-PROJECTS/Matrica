"""Unit tests for the query-generation router's prompt assembly.

The OpenAI call itself is not exercised; what is tested is the step that used to
fail before it — building the instructions — because the prompt ends in a
literal JSON example and was being run through str.format.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.queries import (  # noqa: E402
    DATABASES_PLACEHOLDER,
    QUERIES_SYSTEM_PROMPT,
    databases_brief,
    searched_database_names,
)


def build_instructions(keys: list[str]) -> str:
    """The same assembly the endpoint does."""
    return QUERIES_SYSTEM_PROMPT.replace(DATABASES_PLACEHOLDER, databases_brief(keys))


def test_instructions_name_the_selected_databases():
    text = build_instructions(["pubmed", "europepmc"])
    assert "PubMed" in text
    assert "Europe PMC" in text
    assert DATABASES_PLACEHOLDER not in text


def test_instructions_keep_the_json_example_intact():
    # str.format() raised KeyError on these braces, so the endpoint 500'd for
    # every request that did not carry a custom prompt.
    text = build_instructions(["openalex"])
    assert '"queries": [' in text
    assert '"qualityScore": 78' in text


def test_unknown_database_keys_fall_back_to_the_default_pair():
    text = build_instructions(["not-a-database"])
    assert "OpenAlex" in text and "PubMed" in text


def test_searched_database_names_are_display_names():
    assert searched_database_names(["pubmed"]) == ["PubMed"]


def test_prompt_tells_the_model_to_copy_the_real_topic_id():
    # The example used to carry a concrete id, which the model copied verbatim;
    # a query attributed to an id nobody sent is never shown.
    text = build_instructions(["openalex"])
    assert "copied EXACTLY" in text
    assert '"topicId": "ai-t1"' not in text
