"""Bake Docling / EasyOCR weights into the image.

The API Lambda sits in a private VPC with no NAT, so a first-request download
would hang. Models must live under /var/task (image filesystem), not /tmp
(Lambda scratch, empty every cold start).
"""

from __future__ import annotations

import io
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

DOCLING_DIR = Path("/var/task/.cache/docling/models")
EASYOCR_DIR = Path("/var/task/.cache/easyocr")
PADDLE_DIR = Path("/var/task/.cache/paddlex")
EASYOCR_ZIPS = (
    "https://github.com/JaidedAI/EasyOCR/releases/download/pre-v1.1.6/craft_mlt_25k.zip",
    "https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/english_g2.zip",
)


def _has_models(path: Path) -> bool:
    if not path.is_dir():
        return False
    return any(item.is_file() and item.stat().st_size > 1024 for item in path.rglob("*"))


def _patch_cv2_gstreamer_stub() -> None:
    """OpenCV's gapi init crashes under qemu if GStreamer symbols are missing."""
    old = "cv.gapi.wip.GStreamerPipeline = cv.gapi_wip_gst_GStreamerPipeline"
    new = "cv.gapi.wip.GStreamerPipeline = getattr(cv, 'gapi_wip_gst_GStreamerPipeline', None)"
    root = Path("/var/task/.venv/lib")
    if not root.is_dir():
        return
    for path in root.glob("python*/site-packages/cv2/gapi/__init__.py"):
        text = path.read_text(encoding="utf-8")
        if old in text:
            path.write_text(text.replace(old, new), encoding="utf-8")


def prefetch_docling() -> None:
    if _has_models(DOCLING_DIR):
        print(f"Docling models already present at {DOCLING_DIR}")
        return
    _patch_cv2_gstreamer_stub()
    try:
        from docling.utils.model_downloader import download_models
    except ImportError:
        raise SystemExit("docling extra is required in the Lambda image (--all-extras)")
    DOCLING_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Prefetching Docling models → {DOCLING_DIR}")
    try:
        download_models(
            output_dir=DOCLING_DIR,
            progress=True,
            with_smolvlm=False,
            with_easyocr=False,
        )
    except TypeError:
        try:
            download_models(output_dir=DOCLING_DIR)
        except TypeError:
            download_models()
    _assert_nonempty(DOCLING_DIR, "Docling")


def prefetch_easyocr() -> None:
    """Fetch detector + English recognizer zips.

    Do not construct ``easyocr.Reader`` here: that imports torch, which is
    extremely slow under qemu (linux/amd64 image on Apple Silicon).
    """
    if _has_models(EASYOCR_DIR):
        print(f"EasyOCR models already present at {EASYOCR_DIR}")
        return
    EASYOCR_DIR.mkdir(parents=True, exist_ok=True)
    for url in EASYOCR_ZIPS:
        print(f"Downloading EasyOCR weights {url}")
        with urllib.request.urlopen(url, timeout=300) as resp:
            payload = resp.read()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.extractall(EASYOCR_DIR)
    _assert_nonempty(EASYOCR_DIR, "EasyOCR")


def prefetch_paddle() -> None:
    """Warm PP-StructureV3 so PaddleX official models live under ``PADDLE_PDX_CACHE_HOME``."""
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(PADDLE_DIR))
    if _has_models(PADDLE_DIR):
        print(f"Paddle models already present at {PADDLE_DIR}")
        return
    PADDLE_DIR.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, "/var/task")
    from app.core.config import Settings
    from app.engines.paddle_init import create_pp_structure

    settings = Settings(
        paddle_device="cpu",
        use_table_recognition=True,
        use_formula_recognition=False,
        use_seal_recognition=False,
        use_chart_recognition=False,
        use_region_detection=True,
        paddle_enable_mkldnn=False,
    )
    print(f"Prefetching Paddle models → {PADDLE_DIR}")
    pipeline = create_pp_structure(settings)
    del pipeline
    _assert_nonempty(PADDLE_DIR, "Paddle")


def _assert_nonempty(path: Path, label: str) -> None:
    if not _has_models(path):
        raise SystemExit(f"{label} prefetch produced no files under {path}")


if __name__ == "__main__":
    prefetch_docling()
    prefetch_easyocr()
    prefetch_paddle()
    print("model prefetch done")
