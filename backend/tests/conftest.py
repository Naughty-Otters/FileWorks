from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def _test_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "test-secret-do-not-use-in-prod-please")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path / "history"))
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("LLM_LAMBDA_FUNCTION", "")
    get_settings.cache_clear()
    settings = get_settings()
    settings.llm_provider = None
    settings.llm_api_key = None
    settings.openai_api_key = None
    settings.anthropic_api_key = None
    settings.claude_api_key = None
    settings.deepseek_api_key = None
    settings.openrouter_api_key = None
    settings.fireworks_api_key = None
    settings.grok_api_key = None
    settings.xai_api_key = None
    settings.kimi_api_key = None
    settings.moonshot_api_key = None
    settings.glm_api_key = None
    settings.zhipu_api_key = None
    settings.translate_provider = None
    settings.translate_api_key = None
    settings.llm_lambda_function = None
    settings.google_client_id = None
    settings.database_url = None
    settings.stripe_secret_key = None
    settings.stripe_webhook_secret = None
    settings.stripe_price_basic = None
    settings.stripe_price_pro = None
    settings.stripe_price_premium = None
    yield
    get_settings.cache_clear()
