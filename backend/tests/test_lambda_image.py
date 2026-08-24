from __future__ import annotations

import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PYPROJECT = ROOT / "backend" / "pyproject.toml"
DOCKERFILE = ROOT / "infra" / "docker" / "Dockerfile"
LAMBDA_TF = ROOT / "infra" / "terraform" / "lambda.tf"
PREFETCH = ROOT / "infra" / "docker" / "prefetch-models.py"
COMPOSE = ROOT / "docker-compose.yml"
READING = ROOT / "backend" / "app" / "processing" / "reading"


def _image_extras() -> set[str]:
    data = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    extras = data["project"]["optional-dependencies"]
    return set(extras)


class LambdaReaderImageTests(unittest.TestCase):
    def test_pyproject_extras_are_the_image_package_list(self) -> None:
        extras = _image_extras()
        self.assertEqual(extras, {"docling", "liteparse"})

    def test_dockerfile_installs_all_pyproject_extras(self) -> None:
        body = DOCKERFILE.read_text(encoding="utf-8")
        self.assertIn("uv sync --frozen --no-dev --no-install-project --all-extras", body)
        self.assertIn("uv sync --frozen --no-dev --all-extras", body)
        self.assertNotIn("ARG UV_EXTRA", body)
        self.assertIn("prefetch-models.py", body)
        self.assertIn("tesseract-ocr", body)
        self.assertIn("DOCLING_ARTIFACTS_PATH=/var/task/.cache/docling/models", body)
        self.assertIn("EASYOCR_MODEL_DIR=/var/task/.cache/easyocr", body)
        self.assertIn("PADDLE_PDX_CACHE_HOME=/var/task/.cache/paddlex", body)
        self.assertIn("PYTHONPATH=/var/task:/var/task/.venv/lib/python3.12/site-packages", body)
        self.assertIn("fileworks-venv.pth", body)
        self.assertIn("python /var/task/prefetch-models.py", body)
        self.assertIn("--mount=from=model-cache", body)
        self.assertIn("/mc/var/task/.cache", body)
        self.assertIn("gapi_wip_gst_GStreamerPipeline", body)
        self.assertIn("opencv-python-headless", body)
        self.assertIn("opencv-contrib-python", body)
        self.assertIn("site-packages/nvidia", body)
        self.assertIn('CMD ["/var/task/.venv/bin/python", "-m", "app"]', body)

    def test_prefetch_script_fails_closed_without_extras(self) -> None:
        body = PREFETCH.read_text(encoding="utf-8")
        self.assertIn("raise SystemExit", body)
        self.assertIn("download_models", body)
        self.assertIn("english_g2.zip", body)
        self.assertIn("craft_mlt_25k.zip", body)
        self.assertIn("gapi_wip_gst_GStreamerPipeline", body)
        self.assertIn("prefetch_paddle", body)
        self.assertIn("_ensure_opencv_importable", body)

    def test_lambda_env_points_caches_at_image_fs(self) -> None:
        body = LAMBDA_TF.read_text(encoding="utf-8")
        self.assertIn('DOCLING_ARTIFACTS_PATH = "/var/task/.cache/docling/models"', body)
        self.assertIn('HF_HOME                = "/var/task/.cache/huggingface"', body)
        self.assertIn('EASYOCR_MODEL_DIR      = "/var/task/.cache/easyocr"', body)
        self.assertIn('PADDLE_PDX_CACHE_HOME  = "/var/task/.cache/paddlex"', body)
        self.assertIn('PADDLE_OCR_ENABLED     = "false"', body)
        self.assertIn('PYTHONPATH             = "/var/task:/var/task/.venv/lib/python3.12/site-packages"', body)
        self.assertIn('PATH                   = "/var/task/.venv/bin:/usr/local/bin:/usr/bin:/bin"', body)

    def test_compose_does_not_override_image_extras(self) -> None:
        body = COMPOSE.read_text(encoding="utf-8")
        self.assertNotIn("UV_EXTRA", body)
        self.assertIn("infra/docker/Dockerfile", body)

    def test_build_cmd_uses_dockerfile_without_extra_override(self) -> None:
        import pytest

        pytest.importorskip("rich")
        from fw.actions.cloud import lambda_image_build_cmd
        from fw.context import UV_IMAGE_SYNC_FLAGS

        cmd = lambda_image_build_cmd("example:tag")
        self.assertNotIn("UV_EXTRA", " ".join(cmd))
        self.assertIn("model-cache=docker-image://example:tag", " ".join(cmd))
        self.assertEqual(UV_IMAGE_SYNC_FLAGS, ("--all-extras",))

    def test_roll_out_pins_ecr_digest_not_moving_tag(self) -> None:
        body = (ROOT / "fw" / "actions" / "cloud.py").read_text(encoding="utf-8")
        self.assertIn("def ecr_image_digest_uri", body)
        self.assertIn('return f"{repo_url}@{digest}"', body)
        self.assertIn("pinned = ecr_image_digest_uri(ctx, image)", body)
        self.assertIn("did not switch to", body)

    def test_hydrate_remaps_read_only_baked_cache(self) -> None:
        from app.core import modelcache

        with tempfile.TemporaryDirectory() as raw:
            baked = Path(raw) / "baked"
            runtime = Path(raw) / "runtime"
            models = baked / "paddlex" / "official_models"
            models.mkdir(parents=True)
            (models / "weights.bin").write_bytes(b"x" * 8)
            baked.chmod(0o555)
            original_baked = modelcache.BAKED_CACHE
            original_runtime = modelcache.RUNTIME_CACHE
            try:
                modelcache.BAKED_CACHE = baked
                modelcache.RUNTIME_CACHE = runtime
                modelcache.hydrate_baked_model_cache()
                link = runtime / "paddlex" / "official_models"
                self.assertTrue(link.is_symlink())
                self.assertEqual(os.environ.get("PADDLE_PDX_CACHE_HOME"), str(runtime / "paddlex"))
            finally:
                baked.chmod(0o755)
                modelcache.BAKED_CACHE = original_baked
                modelcache.RUNTIME_CACHE = original_runtime
                os.environ.pop("PADDLE_PDX_CACHE_HOME", None)
                os.environ.pop("HF_HOME", None)

    def test_venv_site_packages_prepended(self) -> None:
        from app.core.venvpath import ensure_venv_on_sys_path, venv_site_packages

        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            site = root / "lib" / "python3.12" / "site-packages"
            site.mkdir(parents=True)
            found = venv_site_packages(root)
            self.assertEqual(found, [str(site)])
            ensure_venv_on_sys_path(root)
            self.assertEqual(sys.path[0], str(site))
            ensure_venv_on_sys_path(root)
            self.assertEqual(sys.path.count(str(site)), 1)

    def test_reader_files_do_not_reuse_wheel_module_names(self) -> None:
        self.assertFalse((READING / "liteparse.py").exists())
        self.assertFalse((READING / "docling.py").exists())
        self.assertTrue((READING / "liteparse_reader.py").is_file())
        self.assertTrue((READING / "docling_reader.py").is_file())

    def test_import_unshadowed_ignores_reader_dir_on_sys_path(self) -> None:
        from app.core.venvpath import drop_reader_dir_from_sys_path, import_unshadowed, reader_modules_dir

        reading = str(reader_modules_dir())
        sys.path.insert(0, reading)
        try:
            drop_reader_dir_from_sys_path()
            self.assertFalse(
                any(
                    Path(entry).resolve() == reader_modules_dir().resolve()
                    for entry in sys.path
                    if entry not in {"", "."}
                )
            )
            shadow = ModuleType("liteparse")
            shadow.__file__ = str(reader_modules_dir() / "liteparse.py")
            sys.modules["liteparse"] = shadow
            try:
                module = import_unshadowed("liteparse")
            except ModuleNotFoundError:
                self.assertNotIn("liteparse", sys.modules)
                return
            origin = Path(getattr(module, "__file__", "") or ".")
            self.assertNotEqual(origin.parent.resolve(), reader_modules_dir().resolve())
            self.assertTrue(hasattr(module, "LiteParse"))
        finally:
            while reading in sys.path:
                sys.path.remove(reading)


if __name__ == "__main__":
    unittest.main()
