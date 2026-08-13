"""Interactive FileWorks operator TUI.

Rich-based text UI in the same shape as OpenFDEServer ``deploy``:

    fw.console      Rich console + prompt helpers (all user I/O)
    fw.context      Runtime context and environment registry
    fw.process      Live-streaming subprocess (PTY)
    fw.tools        AWS CLI / Terraform / Docker helpers
    fw.actions      Local, database, and cloud workflows
    fw.cli          Entry point and main menu loop

Run it with::

    ./scripts/fw
    uv run --with rich python -m fw
"""

__all__ = ["__version__"]

__version__ = "1.0.0"
