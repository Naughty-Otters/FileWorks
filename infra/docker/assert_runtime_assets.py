#!/usr/bin/env python3
"""Fail the Lambda image build if required runtime assets are missing.

Runs after ``COPY backend/app`` in the Dockerfile. Keep this script stdlib-only
and free of ``app.*`` imports — those pull LangChain before the venv is ready.

Set ``FILEWORKS_APP_ROOT`` to override discovery (used in Docker).
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path


def app_root() -> Path:
    override = (os.environ.get("FILEWORKS_APP_ROOT") or "").strip()
    if override:
        root = Path(override)
        if (root / "processing").is_dir():
            return root
        raise SystemExit(f"assert_runtime_assets: FILEWORKS_APP_ROOT invalid: {root}")

    candidates = [
        Path("/var/task/app"),
        Path.cwd() / "app",
        Path.cwd() / "backend" / "app",
    ]
    # Repo checkout only: infra/docker/<this file> → ../../backend/app
    here = Path(__file__).resolve()
    if len(here.parents) > 2:
        candidates.append(here.parents[2] / "backend" / "app")

    tried: list[str] = []
    for candidate in candidates:
        tried.append(str(candidate))
        if (candidate / "processing").is_dir():
            return candidate
    raise SystemExit(
        "assert_runtime_assets: could not locate backend/app "
        f"(tried: {', '.join(tried)})"
    )


def read_system_prompt(prompt_mod: Path) -> str:
    """Parse SYSTEM_PROMPT from the module via AST — no package import."""
    tree = ast.parse(prompt_mod.read_text(encoding="utf-8"), filename=str(prompt_mod))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "SYSTEM_PROMPT":
                value = node.value
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    return value.value
                if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute):
                    # SYSTEM_PROMPT = """...""".strip()
                    if value.func.attr == "strip" and isinstance(value.func.value, ast.Constant):
                        if isinstance(value.func.value.value, str):
                            return value.func.value.value
    raise RuntimeError(f"{prompt_mod} has no string SYSTEM_PROMPT assignment")


def main() -> int:
    root = app_root()
    errors: list[str] = []

    prompt_mod = root / "processing" / "template" / "prompts" / "design_edit_prompt.py"
    if not prompt_mod.is_file():
        errors.append(f"missing {prompt_mod}")
    else:
        try:
            text = read_system_prompt(prompt_mod).strip()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"prompt parse failed: {exc}")
            text = ""
        if not text:
            errors.append("design_edit SYSTEM_PROMPT is empty")
        elif "ops" not in text.lower():
            errors.append("design_edit SYSTEM_PROMPT looks truncated")

    starters = root / "processing" / "template" / "starters" / "data"
    catalog = starters / "catalog.json"
    if not catalog.is_file():
        errors.append(f"missing {catalog}")
    else:
        docs = list(starters.glob("*.json"))
        if len(docs) < 10:
            errors.append(f"starter data looks empty ({len(docs)} json files under {starters})")

    prompts_dir = root / "processing" / "template" / "prompts"
    if prompts_dir.is_dir():
        md_prompts = sorted(p.name for p in prompts_dir.glob("*.md"))
        if md_prompts:
            errors.append(
                "runtime prompts must be Python modules, not .md "
                f"(found {md_prompts} — Docker **/*.md would drop them)"
            )

    if errors:
        print("assert_runtime_assets FAILED:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1
    print(f"assert_runtime_assets ok ({root})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
