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
# Fail the build if dockerignore / COPY dropped required runtime assets.
# A missing prompt previously crashed every Lambda invoke with 502.
COPY infra/docker/assert_runtime_assets.py /tmp/assert_runtime_assets.py
RUN FILEWORKS_APP_ROOT=/var/task/app python /tmp/assert_runtime_assets.py \
    && rm /tmp/assert_runtime_assets.py
RUN uv sync --frozen --no-dev --all-extras
# Lambda is CPU-only and caps uncompressed images at 10 GiB. EasyOCR/torch
# otherwise pull CUDA wheels (~4 GiB nvidia + triton) that cannot run here.
RUN rm -rf /var/task/.venv/lib/python3.12/site-packages/nvidia \
           /var/task/.venv/lib/python3.12/site-packages/triton \
           /var/task/.venv/lib/python3.12/site-packages/triton*
# Docling, EasyOCR, and Paddle each pull a different OpenCV flavor into the
# same ``cv2`` package. Co-installing them circular-imports under qemu
# (``cv2.GMat`` / ``cv2.gapi``). Keep one headless wheel — Docling FAQ.
RUN uv pip uninstall --python /var/task/.venv/bin/python -y \
        opencv-python opencv-contrib-python opencv-python-headless \
    || true \
 && uv pip install --python /var/task/.venv/bin/python --no-cache \
        "opencv-python-headless>=4.8,<4.12"
# OpenCV gapi assigns GStreamerPipeline via ``cv.gapi`` during import; that
# circular-fails under qemu/headless even with getattr. Skip the assignment.
RUN python - <<'PY'
from pathlib import Path
needles = (
    "cv.gapi.wip.GStreamerPipeline = cv.gapi_wip_gst_GStreamerPipeline",
    "cv.gapi.wip.GStreamerPipeline = getattr(cv, 'gapi_wip_gst_GStreamerPipeline', None)",
    'cv.gapi.wip.GStreamerPipeline = getattr(cv, "gapi_wip_gst_GStreamerPipeline", None)',
)
replacement = (
    "# Patched for Lambda/headless: GStreamer symbols are not exported, and "
    "assigning via cv.gapi during import circular-fails.\n"
    "pass  # was: cv.gapi.wip.GStreamerPipeline = …\n"
)
root = Path("/var/task/.venv/lib")
for path in root.glob("python*/site-packages/cv2/gapi/__init__.py"):
    text = path.read_text(encoding="utf-8")
    updated = text
    for needle in needles:
        if needle in updated:
            updated = updated.replace(needle, replacement)
    if updated != text:
        path.write_text(updated, encoding="utf-8")
        print(f"patched {path}")
# Fail the build early if OpenCV is still broken (before model download).
import cv2
print(f"cv2 import ok ({cv2.__version__})")
PY

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
