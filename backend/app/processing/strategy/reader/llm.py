"""LLM reader readiness helpers for ordering strategy."""

from __future__ import annotations

from app.core.config import Settings
from app.engines.llm import LLMEngine


def llm_vision_ready(settings: Settings) -> bool:
    if settings.llm_lambda_function:
        return False
    engine = LLMEngine(settings)
    return engine.configured() and engine.supports_vision
