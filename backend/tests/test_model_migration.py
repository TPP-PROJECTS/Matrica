"""Offline routing and SDK compatibility checks for every model call."""
import ast
import asyncio
import importlib.util
import json
import os
from pathlib import Path
from unittest.mock import patch

import httpx
import openai
import pytest

BACKEND = Path(__file__).resolve().parents[1]


def load_config(env=None):
    spec = importlib.util.spec_from_file_location('isolated_migration_config', BACKEND / 'config.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, env or {}, clear=True), patch('dotenv.load_dotenv'):
        spec.loader.exec_module(module)
    return module


def test_default_normal_and_web_routes():
    config = load_config()
    assert config.response_options() == {'model': 'gpt-6-sol', 'reasoning': {'effort': 'none'}}
    assert config.response_options(True) == {'model': 'gpt-6-sol', 'reasoning': {'effort': 'low'}}


def test_exported_model_and_effort_overrides():
    config = load_config({'OPENAI_MODEL': 'gpt-6.1-sol', 'OPENAI_REASONING_EFFORT': 'medium',
                          'OPENAI_WEB_REASONING_EFFORT': 'high'})
    assert config.response_options()['reasoning']['effort'] == 'medium'
    assert config.response_options(True) == {'model': 'gpt-6.1-sol', 'reasoning': {'effort': 'high'}}


@pytest.mark.parametrize('env,web', [
    ({'OPENAI_MODEL': ' '}, False),
    ({'OPENAI_REASONING_EFFORT': 'invalid'}, False),
    ({'OPENAI_WEB_REASONING_EFFORT': 'invalid'}, True),
    ({'OPENAI_MODEL': 'gpt-6.1-sol'}, False),
    ({'OPENAI_MODEL': 'gpt-6-astra'}, False),
])
def test_invalid_configuration_rejected(env, web):
    with pytest.raises(ValueError):
        load_config(env).response_options(web)


def test_all_real_source_calls_serialize_and_keep_output_text_contract():
    config = load_config()
    captured = []
    def handler(request):
        payload = json.loads(request.content)
        captured.append(payload)
        assert payload['model'] == 'gpt-6-sol'
        assert payload['reasoning']['effort'] == ('low' if payload.get('tools') else 'none')
        assert not {'temperature', 'top_p', 'max_tokens'} & payload.keys()
        return httpx.Response(200, json={
            'id': 'test', 'object': 'response', 'created_at': 0, 'status': 'completed',
            'model': payload['model'], 'output': [{'id': 'msg', 'type': 'message',
            'status': 'completed', 'role': 'assistant',
            'content': [{'type': 'output_text', 'text': '{"ok":true}', 'annotations': []}]}]})
    async def check_calls():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
            client = openai.AsyncOpenAI(api_key='offline-test', http_client=transport)
            for path in (BACKEND / 'routers').glob('*.py'):
                for node in ast.walk(ast.parse(path.read_text())):
                    if not isinstance(node, ast.Call) or not ast.unparse(node.func).endswith('responses.create'):
                        continue
                    # Keep the actual routing, tool and output-format options; replace research input only.
                    node.func = ast.parse('client.responses.create', mode='eval').body
                    for kw in node.keywords:
                        if kw.arg in ('input', 'instructions'):
                            kw.value = ast.Constant('Synthetic test. Return JSON {"ok":true}.')
                    expr = ast.fix_missing_locations(ast.Expression(node))
                    result = await eval(compile(expr, str(path), 'eval'), {
                        'client': client, 'response_options': config.response_options})
                    assert json.loads(result.output_text) == {'ok': True}
    asyncio.run(check_calls())
    assert len(captured) == 30
    assert sum(bool(p.get('tools')) for p in captured) == 3
    assert sum('text' in p for p in captured) == 1
