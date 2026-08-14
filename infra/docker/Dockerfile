# Container image for FileWorks API on AWS Lambda (Lambda Web Adapter).
# Build from repo root:
#   docker build --platform linux/amd64 -f infra/docker/Dockerfile -t fileworks-api .
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 \
    /lambda-adapter /opt/extensions/lambda-adapter

ENV PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/api/health \
    AWS_LWA_READINESS_CHECK_MIN_UNHEALTHY_STATUS=500 \
    AWS_LWA_ASYNC_INIT=true \
    HOME=/tmp \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/var/task/.venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libgomp1 \
        libglib2.0-0 \
        libgl1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.4 /uv /usr/local/bin/uv

WORKDIR /var/task

COPY backend/pyproject.toml backend/uv.lock backend/README.md backend/alembic.ini ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
RUN uv sync --frozen --no-dev

CMD ["python", "-m", "app"]
