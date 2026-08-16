"""Runtime context, environment registry, and on-disk layout.

Pure data + light helpers. No AWS or Terraform side effects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
INFRA_DIR = ROOT_DIR / "infra"
TF_DIR = INFRA_DIR / "terraform"
BOOTSTRAP_DIR = TF_DIR / "bootstrap"
IAM_POLICY_PATH = INFRA_DIR / "iam" / "fileworks-deploy-policy.json"
DOCKERFILE = INFRA_DIR / "docker" / "Dockerfile"
BACKEND_DIR = ROOT_DIR / "backend"
BACKEND_ENV = BACKEND_DIR / ".env"
FRONTEND_DIR = ROOT_DIR / "frontend"

DEFAULT_REGION = "us-east-1"
DEFAULT_DATABASE_URL = "postgresql+psycopg://fileworks:fileworks@127.0.0.1:5432/fileworks"
POLICY_NAME = "FileWorksDeploy"
LAMBDA_CONCURRENT_SERVICE = "lambda"
LAMBDA_CONCURRENT_QUOTA_CODE = "L-B99A9384"
DEFAULT_LAMBDA_ACCOUNT_CONCURRENCY = 1000

REQUIRED_IAM_ACTIONS = (
    "lambda:CreateFunction",
    "lambda:UpdateFunctionCode",
    "lambda:CreateFunctionUrlConfig",
    "lambda:PublishVersion",
    "lambda:UpdateAlias",
    "iam:PassRole",
    "iam:CreateRole",
    "ecr:CreateRepository",
    "ecr:PutImage",
    "s3:CreateBucket",
    "secretsmanager:CreateSecret",
    "logs:CreateLogGroup",
    "servicequotas:GetServiceQuota",
    "servicequotas:RequestServiceQuotaIncrease",
    "application-autoscaling:RegisterScalableTarget",
)

SECRET_ENV_PREFIXES = (
    "LLM_",
    "TRANSLATE_",
    "OPENROUTER_",
    "FIREWORKS_",
    "DEEPSEEK_",
    "KIMI_",
    "MOONSHOT_",
    "GLM_",
    "ZHIPU_",
    "OPENAI_",
    "GROK_",
    "XAI_",
    "ANTHROPIC_",
    "CLAUDE_",
    "GEMINI_",
    "STRIPE_",
)
SECRET_EXACT_KEYS = {"GOOGLE_CLIENT_ID", "GOOGLE_API_KEY", "PUBLIC_APP_URL"}


@dataclass(frozen=True)
class Environment:
    name: str
    aliases: tuple[str, ...] = ()

    @property
    def prefix(self) -> str:
        return f"fileworks-{self.name}"

    @property
    def s3_alias(self) -> str:
        return "stage" if self.name == "staging" else self.name

    @property
    def tfvars_file(self) -> Path:
        return TF_DIR / "envs" / f"{self.name}.tfvars"

    @property
    def local_tfvars_file(self) -> Path:
        return TF_DIR / "envs" / f"{self.name}.local.tfvars"

    @property
    def dotenv_overlay(self) -> Path:
        """Optional backend/.env.<env> overrides used when seeding this environment."""
        return BACKEND_DIR / f".env.{self.name}"

    @property
    def pages_project(self) -> str:
        return f"fileworks-{self.name}"

    @property
    def pages_origin(self) -> str:
        return f"https://{self.pages_project}.pages.dev"

    @property
    def public_origin(self) -> str:
        if self.name == "prod":
            return "https://fileworks.ai"
        if self.name == "staging":
            return "https://staging.fileworks.ai"
        return self.pages_origin

    @property
    def api_origin(self) -> str:
        if self.name == "prod":
            return "https://api.fileworks.ai"
        if self.name == "staging":
            return "https://api.staging.fileworks.ai"
        return ""

    @property
    def ecr_repository(self) -> str:
        return self.prefix

    @property
    def is_production(self) -> bool:
        return self.name == "prod"


ENVIRONMENTS: dict[str, Environment] = {
    "dev": Environment(name="dev", aliases=("development",)),
    "staging": Environment(name="staging", aliases=("stage",)),
    "prod": Environment(name="prod", aliases=("production", "prd")),
}


def is_lambda_function_url(url: str) -> bool:
    host = url.lower()
    return "lambda-url." in host and ".on.aws" in host


def resolve_public_api_url(*candidates: str) -> str:
    """First non-empty API origin. Custom hosts win over a raw Lambda Function URL."""
    fallback = ""
    for raw in candidates:
        text = (raw or "").strip().rstrip("/")
        if not text:
            continue
        if is_lambda_function_url(text):
            if not fallback:
                fallback = text
            continue
        return text
    return fallback


def resolve_environment(token: str) -> Environment | None:
    token = token.strip().lower()
    for env in ENVIRONMENTS.values():
        if token == env.name or token in env.aliases:
            return env
    return None


def state_bucket_name(account: str) -> str:
    return f"fileworks-tfstate-{account}"


@dataclass
class Session:
    """Active AWS identity for CLI calls (profile is exported as AWS_PROFILE)."""

    profile: str | None
    region: str
    account_id: str
    arn: str

    @property
    def profile_label(self) -> str:
        return self.profile or "(default credentials)"


@dataclass
class Context:
    """Mutable app state passed to every action."""

    env: Environment
    region: str = DEFAULT_REGION
    session: Session | None = None
    auto_yes: bool = False
    root: Path = ROOT_DIR
    extras: dict[str, str] = field(default_factory=dict)
    # "local" = Compose/native Postgres. "cloud" = RDS for ctx.env (private VPC).
    scope: str = "local"

    @property
    def is_cloud(self) -> bool:
        return self.scope == "cloud"

    @property
    def account_id(self) -> str:
        if self.session is None:
            raise RuntimeError("AWS session is not established")
        return self.session.account_id
