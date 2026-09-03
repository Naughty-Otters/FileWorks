from __future__ import annotations

from app.core.config import Settings
from app.engines.llm.design_agent import DesignAgentEngine


def test_design_agent_uses_dedicated_settings() -> None:
    settings = Settings(
        design_agent_provider="gemini",
        design_agent_model="gemini-3.8-flash",
        design_agent_api_key="design-key",
        design_agent_max_tokens=16384,
        llm_provider="gemini",
        llm_model="gemini-3.5-flash-lite",
        llm_api_key="vision-key",
    )
    engine = DesignAgentEngine(settings)
    assert engine.configured()
    assert engine._using_llm_fallback is False
    assert engine._model() == "gemini-3.8-flash"
    assert engine._api_key() == "design-key"
    assert engine._max_tokens() == 16384
    info = engine.describe()
    assert info["id"] == "design-agent"
    assert info["model"] == "gemini-3.8-flash"
    assert info["using_llm_fallback"] is False


def test_design_agent_falls_back_to_llm_when_unset() -> None:
    settings = Settings(
        design_agent_provider=None,
        llm_provider="openai",
        llm_model="gpt-4o",
        llm_api_key="sk-test",
        llm_max_tokens=8192,
    )
    engine = DesignAgentEngine(settings)
    assert engine.configured()
    assert engine._using_llm_fallback is True
    assert engine._model() == "gpt-4o"
    assert engine._api_key() == "sk-test"
    assert engine._max_tokens() == 16384  # design-edit headroom


def test_design_agent_reuses_matching_llm_api_key() -> None:
    settings = Settings(
        design_agent_provider="gemini",
        design_agent_model="gemini-3.8-flash",
        design_agent_api_key=None,
        llm_provider="gemini",
        llm_api_key="shared-gemini-key",
    )
    engine = DesignAgentEngine(settings)
    assert engine.configured()
    assert engine._api_key() == "shared-gemini-key"


def test_design_agent_unconfigured_without_providers() -> None:
    settings = Settings(design_agent_provider=None, llm_provider=None)
    engine = DesignAgentEngine(settings)
    assert not engine.configured()
    assert engine.init_error
