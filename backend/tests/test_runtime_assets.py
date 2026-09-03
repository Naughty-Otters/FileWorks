"""Packaging guards — catch Docker asset drops before they take down staging."""

from __future__ import annotations

import os
import runpy
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSERT = ROOT / "infra" / "docker" / "assert_runtime_assets.py"
APP = ROOT / "backend" / "app"


def _load_assert():
    return runpy.run_path(str(ASSERT), run_name="assert_runtime_assets")


def test_assert_runtime_assets_passes_on_checkout() -> None:
    assert ASSERT.is_file()
    ns = _load_assert()
    assert ns["main"]() == 0


def test_assert_works_when_script_lives_under_tmp(tmp_path: Path) -> None:
    """Docker copies the assert to /tmp — parents[2] must not IndexError."""
    script = tmp_path / "assert_runtime_assets.py"
    shutil.copy(ASSERT, script)
    env = {**os.environ, "FILEWORKS_APP_ROOT": str(APP)}
    proc = subprocess.run(
        [sys.executable, str(script)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    assert "assert_runtime_assets ok" in proc.stdout


def test_assert_fails_when_prompt_missing(tmp_path: Path) -> None:
    fake_app = tmp_path / "app"
    prompts = fake_app / "processing" / "template" / "prompts"
    starters = fake_app / "processing" / "template" / "starters" / "data"
    prompts.mkdir(parents=True)
    starters.mkdir(parents=True)
    (starters / "catalog.json").write_text("{}", encoding="utf-8")
    for i in range(10):
        (starters / f"t{i}.json").write_text("{}", encoding="utf-8")
    env = {**os.environ, "FILEWORKS_APP_ROOT": str(fake_app)}
    proc = subprocess.run(
        [sys.executable, str(ASSERT)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 1
    assert "design_edit_prompt.py" in (proc.stderr + proc.stdout)


def test_dockerignore_documents_md_trap() -> None:
    text = (ROOT / ".dockerignore").read_text(encoding="utf-8")
    assert "**/*.md" in text
    assert "Python modules" in text or "runtime prompts" in text.lower()
    assert "!backend/app/processing/template/prompts/**/*.md" not in text


def test_no_runtime_md_prompts_under_app() -> None:
    prompts = APP / "processing" / "template" / "prompts"
    assert prompts.is_dir()
    assert list(prompts.glob("*.md")) == [], "use design_edit_prompt.py, not .md"


def test_dockerfile_pins_app_root_for_assert() -> None:
    dockerfile = (ROOT / "infra" / "docker" / "Dockerfile").read_text(encoding="utf-8")
    assert "assert_runtime_assets.py" in dockerfile
    assert "FILEWORKS_APP_ROOT=/var/task/app" in dockerfile


def test_prompt_module_parses_via_ast() -> None:
    ns = _load_assert()
    prompt = APP / "processing" / "template" / "prompts" / "design_edit_prompt.py"
    text = ns["read_system_prompt"](prompt)
    assert "tools" in text.lower()
    assert len(text.strip()) > 100
