"""Keep the uv venv on ``sys.path`` and unshadow reader filenames.

Two Lambda traps:

1. The convert worker is ``spawn``ed and may run ``/usr/local/bin/python``,
   which does not see ``/var/task/.venv`` unless we put it on ``sys.path``.
2. Readers used to live at ``app/processing/reading/docling.py`` and
   ``liteparse.py``. If that directory is on ``sys.path`` (spawn/cwd),
   ``import liteparse`` loaded *our* module instead of the wheel, which
   looked like "extra is not installed".
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import ModuleType

DEFAULT_VENV = Path("/var/task/.venv")


def venv_site_packages(root: Path | None = None) -> list[str]:
    lib = (root or DEFAULT_VENV) / "lib"
    if not lib.is_dir():
        return []
    return sorted(str(path) for path in lib.glob("python*/site-packages") if path.is_dir())


def reader_modules_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "processing" / "reading"


def _resolved(path: str) -> Path | None:
    if not path or path == ".":
        return None
    try:
        return Path(path).resolve()
    except OSError:
        return None


def drop_reader_dir_from_sys_path() -> None:
    """Stop ``reading/*.py`` from winning over third-party wheels of the same name."""
    reading = reader_modules_dir()
    if not reading.is_dir():
        return
    target = reading.resolve()
    cwd = Path.cwd().resolve()
    kept: list[str] = []
    for entry in sys.path:
        if entry in {"", "."}:
            if cwd == target:
                continue
            kept.append(entry)
            continue
        resolved = _resolved(entry)
        if resolved == target:
            continue
        kept.append(entry)
    sys.path[:] = kept


def ensure_venv_on_sys_path(root: Path | None = None) -> None:
    drop_reader_dir_from_sys_path()
    for path in reversed(venv_site_packages(root)):
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)


def _is_reader_shadow(module: ModuleType, name: str) -> bool:
    origin = getattr(module, "__file__", "") or ""
    if not origin:
        return False
    reading = reader_modules_dir()
    try:
        return Path(origin).resolve().parent == reading.resolve()
    except OSError:
        return "processing/reading" in origin.replace("\\", "/")


def import_unshadowed(name: str) -> ModuleType:
    """Import third-party ``name``, not ``app.processing.reading.<name>``."""
    ensure_venv_on_sys_path()
    existing = sys.modules.get(name)
    if existing is not None and _is_reader_shadow(existing, name):
        del sys.modules[name]
        for key in list(sys.modules):
            if key.startswith(name + ".") and key in sys.modules:
                origin = getattr(sys.modules[key], "__file__", "") or ""
                if "processing/reading" in origin.replace("\\", "/"):
                    del sys.modules[key]
    return importlib.import_module(name)
