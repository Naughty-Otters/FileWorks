from functools import lru_cache
from pathlib import Path
from typing import Annotated
import json
import logging
import os

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core.modelcache import hydrate_baked_model_cache
from app.core.venvpath import ensure_venv_on_sys_path

logger = logging.getLogger(__name__)

_IN_LAMBDA = bool(
    os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or os.environ.get("AWS_LWA_INVOKE_MODE")
)
ensure_venv_on_sys_path()
hydrate_baked_model_cache()


def _hydrate_secrets_from_aws() -> None:
    """Load FILEWORKS_SECRET_ARN JSON into os.environ (does not override existing keys)."""
    arn = os.environ.get("FILEWORKS_SECRET_ARN")
    if not arn:
        return
    try:
        import boto3
    except ImportError:
        logger.warning("FILEWORKS_SECRET_ARN is set but boto3 is not installed")
        return
    try:
        client = boto3.client("secretsmanager")
        raw = client.get_secret_value(SecretId=arn).get("SecretString") or "{}"
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            return
        for key, value in payload.items():
            if value is None or value == "":
                continue
            env_key = str(key)
            if env_key not in os.environ:
                os.environ[env_key] = str(value)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load FILEWORKS_SECRET_ARN: %s", exc)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    app_name: str = "FileWorks"
    api_prefix: str = "/api"
    # CSV or JSON list. NoDecode: pydantic-settings would otherwise json.loads
    # CORS_ORIGINS=http://localhost:3000,... (Compose / Lambda) and crash.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    # Optional regex for preview hosts (e.g. staging Cloudflare Pages). Empty = off.
    cors_origin_regex: str = ""
    upload_dir: Path = (
        Path("/tmp/uploads") if _IN_LAMBDA else Path(__file__).resolve().parents[2] / "uploads"
    )
    fileworks_secret_arn: str | None = None
    max_upload_mb: int = 50
    paddle_device: str = "cpu"
    # Cap how long a run waits for another run's model load, so an abandoned
    # load cannot hang every later request behind its lock.
    engine_load_timeout_s: float = 120
    # Conversion is blocking CPU work: how many may run at once, and how long a
    # queued run waits for a slot before the caller is told the server is busy.
    # One at a time by default: a shared Paddle model is not guaranteed thread-safe.
    convert_max_concurrent: int = 1
    convert_queue_timeout_s: float = 60
    # Convert in a child process so Stop can end it. Off falls back to a thread,
    # which cannot be interrupted once native inference starts.
    convert_in_subprocess: bool = True
    # Load models right after a worker spawns instead of on its first job. Costs
    # a Paddle load even for documents that never reach OCR.
    convert_worker_prewarm: bool = False
    # Pipeline spec (see processing/pipeline_config.py). Existing engine flags
    # below are the source of truth; these gate stages and readers that had none.
    text_reader_enabled: bool = True
    docling_enabled: bool = True
    anydoc_enabled: bool = True
    llm_reader_enabled: bool = True
    pipeline_prepare_ocr_enabled: bool = True
    pipeline_media_enabled: bool = True
    pipeline_structure_edit_enabled: bool = True
    pipeline_translate_enabled: bool = True
    pipeline_normalize_enabled: bool = True
    pipeline_fill_enabled: bool = True
    pipeline_project_enabled: bool = True
    # In-process Paddle (PP-OCR / PP-StructureV3). Off: OCRReader is not a
    # pipeline candidate, LiteParse will not load Paddle, warmup/prewarm skip
    # model load. Set PADDLE_OCR_ENABLED=true to restore it.
    paddle_ocr_enabled: bool = False
    # Preferred OCR provider for warmup / legacy OCRService: structure | ocr
    # Document uploads use readers: Text → Docling (prefer_structure) → AnyDoc → LLM (optional) → OCR.
    ocr_engine: str = "ocr"
    use_doc_orientation_classify: bool = False
    use_doc_unwarping: bool = False
    use_textline_orientation: bool = False
    use_table_recognition: bool = True
    # Formula / seal / chart models are heavy and unstable on CPU / Mac ARM — off by default.
    use_formula_recognition: bool = False
    use_seal_recognition: bool = False
    use_chart_recognition: bool = False
    use_region_detection: bool = True
    paddle_enable_mkldnn: bool = False
    # OCR input prep: cap raster long edge before Paddle (~150 dpi / ~300 dpi A4).
    ocr_max_input_side_default: int = 1754
    ocr_max_input_side_high: int = 2480
    # Optional hard cap (e.g. 1200 for Docker on Apple Silicon — Paddle segfaults above ~1296 px).
    ocr_platform_max_input_side: int | None = None

    # Baked Docling weights on Lambda (/var/task); HOME=/tmp is empty scratch.
    docling_artifacts_path: str | None = None

    # LiteParse local parser (optional extra; image installs via uv sync --all-extras).
    liteparse_enabled: bool = True
    liteparse_priority: int = 35  # after LLM (30), before Paddle OCR (50)
    liteparse_dpi: int = 150
    liteparse_ocr_language: str = "eng"
    liteparse_ocr_server_url: str | None = None  # legacy single URL; prefer ocr_unified_server_url
    liteparse_use_paddle_ocr: bool = True
    liteparse_route_by_complexity: bool = True

    # LiteParse OCR callback URLs (where LiteParse POSTs page images). Default: local /api/ocr/*.
    ocr_fast_server_url: str | None = None
    ocr_deep_server_url: str | None = None
    ocr_unified_server_url: str | None = None

    # EasyOCR tier for LiteParse (between Tesseract and Paddle PP-OCR).
    easyocr_enabled: bool = True
    easyocr_use_gpu: bool = False
    easyocr_ocr_server_url: str | None = None  # legacy alias for ocr_fast_server_url
    easyocr_model_dir: str | None = None  # baked path on Lambda; HOME=/tmp is empty scratch

    # Deep OCR chain (Paddle → Surya) — optional, off until surya extra is wired.
    surya_enabled: bool = False

    # LLM reader (optional). Inactive until LLM_PROVIDER and a matching API key are set.
    # Providers: openrouter | fireworks | deepseek | kimi | glm | openai | grok | claude | gemini
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None  # generic override for the selected provider
    llm_base_url: str | None = None  # OpenAI-style root, e.g. https://openrouter.ai/api/v1
    llm_endpoint: str | None = None  # optional full POST URL (chat/completions or custom OCR path)
    llm_priority: int = 30  # when use_ai: before LiteParse (35) and OCR (50)
    llm_priority_fallback: int = 95  # when use_ai off: last reader in the stack
    llm_max_tokens: int = 8192
    llm_timeout_s: float = 120
    llm_max_pages: int = 8
    llm_max_image_side: int = 2048
    # Per-provider secrets (set the one you use; unused keys can stay empty)
    openrouter_api_key: str | None = None
    openrouter_base_url: str | None = None
    fireworks_api_key: str | None = None
    fireworks_base_url: str | None = None
    deepseek_api_key: str | None = None
    deepseek_base_url: str | None = None
    kimi_api_key: str | None = None
    kimi_base_url: str | None = None
    moonshot_api_key: str | None = None
    glm_api_key: str | None = None
    glm_base_url: str | None = None
    zhipu_api_key: str | None = None
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    grok_api_key: str | None = None
    grok_base_url: str | None = None
    xai_api_key: str | None = None
    anthropic_api_key: str | None = None
    claude_api_key: str | None = None
    claude_base_url: str | None = None
    gemini_api_key: str | None = None
    gemini_base_url: str | None = None
    google_api_key: str | None = None  # Gemini / AI Studio; not GOOGLE_CLIENT_ID

    # Translation post-process (optional, separate from the vision LLM reader).
    # Inactive until TRANSLATE_PROVIDER and a matching API key are set.
    # Text-only models are fine here (e.g. hosted DeepSeek).
    translate_provider: str | None = None
    translate_model: str | None = None
    translate_api_key: str | None = None
    translate_base_url: str | None = None
    translate_endpoint: str | None = None
    translate_max_tokens: int = 8192
    translate_timeout_s: float = 120
    translate_chunk_chars: int = 8000

    # Design Agent (template editor chat). Separate from vision LLM_PROVIDER.
    # When unset, design edit falls back to the vision LLM settings.
    design_agent_provider: str | None = None
    design_agent_model: str | None = None
    design_agent_api_key: str | None = None
    design_agent_base_url: str | None = None
    design_agent_endpoint: str | None = None
    design_agent_max_tokens: int = 16384
    design_agent_timeout_s: float = 120
    # Second LLM "repair" pass after layout QA. Off by default — doubles latency
    # and often trips the Next.js / Cloudflare proxy (socket hang up).
    design_agent_repair_pass: bool = False

    # Document history storage: local path today, switch to s3 later.
    storage_backend: str = "local"  # local | s3
    storage_local_root: Path = Path(__file__).resolve().parents[2] / "data" / "history"
    s3_bucket: str | None = None
    s3_prefix: str = "fileworks"
    s3_region: str | None = None
    s3_endpoint_url: str | None = None
    # Browser PUTs land here: s3://<bucket>/upload/files/<user_id>/<file>
    s3_upload_bucket: str | None = None
    s3_upload_prefix: str = "upload/files"

    database_url: str | None = None
    jwt_secret: str = "dev-insecure-change-me"
    google_client_id: str | None = None
    access_token_ttl_s: int = 3600
    refresh_token_ttl_days: int = 30
    # When set, vision LLM + translation run on a sibling Lambda (no VPC / NAT).
    llm_lambda_function: str | None = None

    # Stripe subscriptions. STRIPE_PRICE_* may be a Dashboard id (price_...) or
    # a monthly USD amount (5). STRIPE_PRICE_*_YEARLY is the annual price (id or
    # dollars); when unset, yearly is derived as 30% off 12× monthly. When
    # STRIPE_SECRET_KEY is set, paid grades go through Checkout instead of
    # POST /me/plan.
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_price_basic: str | None = None
    stripe_price_pro: str | None = None
    stripe_price_premium: str | None = None
    stripe_price_api_builder: str | None = None
    stripe_price_api_scale: str | None = None
    stripe_price_api_business: str | None = None
    stripe_price_pro_yearly: str | None = None
    stripe_price_premium_yearly: str | None = None
    stripe_price_api_builder_yearly: str | None = None
    stripe_price_api_scale_yearly: str | None = None
    stripe_price_api_business_yearly: str | None = None
    # Required when Stripe Managed Payments is on (sandbox default).
    # txcd_10103000 = Software as a service (SaaS).
    stripe_tax_code: str = "txcd_10103000"
    public_app_url: str = "http://localhost:3000"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if value is None or value == "":
            return ["http://localhost:3000", "http://127.0.0.1:3000"]
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return ["http://localhost:3000", "http://127.0.0.1:3000"]
            if text.startswith("["):
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
                return parsed
            return [part.strip() for part in text.split(",") if part.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    _hydrate_secrets_from_aws()
    settings = Settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if settings.storage_backend.lower() == "local":
        settings.storage_local_root.mkdir(parents=True, exist_ok=True)
    return settings
