"""Run external commands while streaming their output live to the terminal.

Terraform, Docker, etc. only emit their interactive/colored progress when they
believe stdout is a real terminal. A normal subprocess often buffers until exit.

To keep live progress we attach the child to a pseudo-terminal (PTY) on POSIX
and copy its output through in real time. Fallbacks:
  * no TTY on our side  -> line-buffered pipe passthrough
  * non-POSIX platform  -> inherit stdio directly
"""

from __future__ import annotations

import os
import select
import subprocess
import sys


def run_streaming(args: list[str], env: dict[str, str] | None = None, cwd: str | None = None) -> int:
    """Execute ``args`` and stream stdout/stderr live. Returns the exit code."""

    if os.name == "posix" and sys.stdout.isatty():
        return _run_with_pty(args, env, cwd)
    if sys.stdout.isatty():
        return subprocess.run(args, env=env, cwd=cwd).returncode
    return _run_piped(args, env, cwd)


def _run_with_pty(args: list[str], env: dict[str, str] | None, cwd: str | None) -> int:
    import pty

    master_fd, slave_fd = pty.openpty()
    try:
        proc = subprocess.Popen(
            args,
            env=env,
            cwd=cwd,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True,
        )
    except Exception:
        os.close(master_fd)
        os.close(slave_fd)
        raise

    os.close(slave_fd)

    try:
        while True:
            try:
                ready, _, _ = select.select([master_fd], [], [])
            except InterruptedError:
                continue
            if master_fd not in ready:
                continue
            try:
                data = os.read(master_fd, 65536)
            except OSError:
                break
            if not data:
                break
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        raise
    finally:
        os.close(master_fd)

    return proc.wait()


def _run_piped(args: list[str], env: dict[str, str] | None, cwd: str | None) -> int:
    proc = subprocess.Popen(
        args,
        env=env,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        raise
    return proc.wait()
