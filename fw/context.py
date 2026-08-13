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

REQUIRED_IAM_ACTIONS = (
    "lambda:CreateFunction",
    "lambda:UpdateFunctionCode",
    "lambda:CreateFunctionUrlConfig",
    "iam:PassRole",
    "iam:CreateRole",
    "ecr:CreateRepository",
    "ecr:PutImage",
    "s3:CreateBucket",
    "secretsmanager:CreateSecret",
    "logs:CreateLogGroup",
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
)
SECRET_EXACT_KEYS = {"GOOGLE_CLIENT_ID"}


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
    def pages_project(self) -> str:
        return f"fileworks-{self.name}"

    @property
    def pages_origin(self) -> str:
        return f"https://{self.pages_project}.pages.dev"

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

    @property
    def account_id(self) -> str:
        if self.session is None:
            raise RuntimeError("AWS session is not established")
        return self.session.account_id
