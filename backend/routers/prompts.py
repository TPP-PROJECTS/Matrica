from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Imported lazily to avoid circular imports
def _get_prompts() -> dict[str, str]:
    from routers.topics import TOPICS_SYSTEM_PROMPT
    from routers.queries import QUERIES_SYSTEM_PROMPT
    from routers.synthesis import SYNTHESIS_SYSTEM_PROMPT, REGEN_SYSTEM_PROMPT
    from routers.gaps import GAP_SYSTEM_PROMPT
    from routers.final_question import TOPICS_SYSTEM, STRUCTURE_SYSTEM
    from routers.matrix import SYSTEM_PROMPT, SYSTEM_REVIEW_PROMPT, AUTOFILL_LITERATURE_PROMPT, AUTOFILL_SYSTEM_PROMPT
    from routers.screening import SCREENING_SYSTEM_PROMPT

    return {
        'topics-generate': TOPICS_SYSTEM_PROMPT,
        'queries-generate': QUERIES_SYSTEM_PROMPT,
        'synthesis-generate': SYNTHESIS_SYSTEM_PROMPT,
        'synthesis-block': REGEN_SYSTEM_PROMPT,
        'gaps-generate': GAP_SYSTEM_PROMPT,
        'final-topics': TOPICS_SYSTEM,
        'final-structure': STRUCTURE_SYSTEM,
        'matrix-lit-columns': SYSTEM_PROMPT,
        'matrix-sys-columns': SYSTEM_REVIEW_PROMPT,
        'matrix-lit-autofill': AUTOFILL_LITERATURE_PROMPT,
        'matrix-sys-autofill': AUTOFILL_SYSTEM_PROMPT,
        'screening-classify': SCREENING_SYSTEM_PROMPT,
    }


class PromptResponse(BaseModel):
    system_prompt: str


@router.get('/prompts/{key}', response_model=PromptResponse)
def get_prompt(key: str):
    prompts = _get_prompts()
    if key not in prompts:
        raise HTTPException(status_code=404, detail=f'Unknown prompt key: {key}')
    return PromptResponse(system_prompt=prompts[key])
