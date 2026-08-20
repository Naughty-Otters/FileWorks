# syntax=docker/dockerfile:1
# Container image for FileWorks API on AWS Lambda (Lambda Web Adapter).
# Build from repo root (Lambda needs Docker V2 schema 2, not OCI attestations):
#   docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
#     -f infra/docker/Dockerfile -t fileworks-api \
#     --output type=image,name=fileworks-api,oci-mediatypes=false,push=true .
# `fw push-image` overrides the model-cache context with the previously
# published image so qemu does not re-import Docling/OpenCV.
FROM scratch AS model-cache
COPY infra/docker/empty-dot-cache /var/task/.cache/

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
        tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.4 /uv /usr/local/bin/uv

WORKDIR /var/task

COPY backend/pyproject.toml backend/uv.lock backend/README.md backend/alembic.ini ./
# Package list is [project.optional-dependencies] in pyproject.toml.
# --all-extras keeps Compose / staging / prod on that one list (no UV_EXTRA).
RUN uv sync --frozen --no-dev --no-install-project --all-extras

COPY backend/app ./app
RUN uv sync --frozen --no-dev --all-extras
# Lambda is CPU-only and caps uncompressed images at 10 GiB. EasyOCR/torch
# otherwise pull CUDA wheels (~4 GiB nvidia + triton) that cannot run here.
RUN rm -rf /var/task/.venv/lib/python3.12/site-packages/nvidia \
           /var/task/.venv/lib/python3.12/site-packages/triton \
           /var/task/.venv/lib/python3.12/site-packages/triton*
# OpenCV gapi assumes GStreamer symbols that this wheel does not export.
RUN python -c "from pathlib import Path; old='cv.gapi.wip.GStreamerPipeline = cv.gapi_wip_gst_GStreamerPipeline'; new='cv.gapi.wip.GStreamerPipeline = getattr(cv, \"gapi_wip_gst_GStreamerPipeline\", None)';\
[p.write_text(p.read_text().replace(old,new), encoding='utf-8') for p in Path('/var/task/.venv/lib').glob('python*/site-packages/cv2/gapi/__init__.py') if old in p.read_text()]"

# `fw push-image` overrides the model-cache context with the previously
# published image so qemu does not re-import Docling/OpenCV. Older images
# may not have /var/task/.cache yet — copy when present, else start empty.
ENV DOCLING_ARTIFACTS_PATH=/var/task/.cache/docling/models \
    HF_HOME=/var/task/.cache/huggingface \
    EASYOCR_MODEL_DIR=/var/task/.cache/easyocr \
    PADDLE_PDX_CACHE_HOME=/var/task/.cache/paddlex \
    TMPDIR=/tmp
RUN --mount=from=model-cache,target=/mc,readonly \
    mkdir -p /var/task/.cache \
    && if [ -d /mc/var/task/.cache ]; then cp -a /mc/var/task/.cache/. /var/task/.cache/; fi
COPY infra/docker/prefetch-models.py /var/task/prefetch-models.py
RUN python /var/task/prefetch-models.py && rm /var/task/prefetch-models.py

ENV VIRTUAL_ENV=/var/task/.venv \
    PYTHONPATH=/var/task:/var/task/.venv/lib/python3.12/site-packages
# System Python (Lambda Web Adapter / spawn) must see the uv venv.
RUN echo /var/task/.venv/lib/python3.12/site-packages \
    > /usr/local/lib/python3.12/site-packages/fileworks-venv.pth

CMD ["/var/task/.venv/bin/python", "-m", "app"]
