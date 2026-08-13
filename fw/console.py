"""All terminal I/O lives here so the rest of the tool stays presentation-free.

Thin wrappers around Rich keep prompts, tables, and status styling consistent
and make the higher-level workflow code read like plain English.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table
from rich.text import Text

console = Console()


@dataclass(frozen=True)
class Choice:
    """A selectable menu option: a stable ``key`` plus a human ``label``."""

    key: str
    label: str
    hint: str = ""


def rule(title: str) -> None:
    console.rule(f"[bold cyan]{title}")


def header(title: str, subtitle: str = "") -> None:
    body = Text(title, style="bold white")
    if subtitle:
        body.append(f"\n{subtitle}", style="dim")
    console.print(Panel(body, border_style="cyan", expand=False))


def info(message: str) -> None:
    console.print(f"[cyan]i[/cyan] {message}")


def success(message: str) -> None:
    console.print(f"[bold green]OK[/bold green] {message}")


def warn(message: str) -> None:
    console.print(f"[bold yellow]![/bold yellow] {message}")


def error(message: str) -> None:
    console.print(f"[bold red]x[/bold red] {message}")


def blank() -> None:
    console.print()


def kv_table(title: str, rows: Iterable[tuple[str, str]]) -> None:
    table = Table(
        title=title, title_style="bold", box=None, show_header=False, pad_edge=False
    )
    table.add_column(style="dim", justify="right")
    table.add_column()
    for key, value in rows:
        table.add_row(key, value)
    console.print(table)


def data_table(
    title: str, columns: Sequence[str], rows: Iterable[Sequence[str]]
) -> None:
    table = Table(title=title, title_style="bold", header_style="bold cyan")
    for column in columns:
        table.add_column(column)
    any_row = False
    for row in rows:
        table.add_row(*[str(cell) for cell in row])
        any_row = True
    if not any_row:
        console.print(f"[dim]{title}: (none)[/dim]")
        return
    console.print(table)


def select(prompt: str, choices: Sequence[Choice], default: str | None = None) -> str:
    """Render a numbered menu and return the chosen ``Choice.key``."""

    blank()
    for index, choice in enumerate(choices, start=1):
        line = f"  [bold]{index}[/bold]. {choice.label}"
        if choice.hint:
            line += f"  [dim]{choice.hint}[/dim]"
        console.print(line)
    valid = {str(i) for i in range(1, len(choices) + 1)}
    default_index = None
    if default is not None:
        for index, choice in enumerate(choices, start=1):
            if choice.key == default:
                default_index = str(index)
                break
    while True:
        answer = Prompt.ask(f"[bold]{prompt}[/bold]", default=default_index)
        if answer in valid:
            return choices[int(answer) - 1].key
        error("Enter one of the listed numbers.")


def confirm(prompt: str, default: bool = False) -> bool:
    return Confirm.ask(f"[bold]{prompt}[/bold]", default=default)


def ask_text(prompt: str, default: str | None = None, password: bool = False) -> str:
    return Prompt.ask(f"[bold]{prompt}[/bold]", default=default, password=password)


def confirm_phrase(prompt: str, phrase: str) -> bool:
    """Require the user to type an exact phrase (used for destructive actions)."""

    typed = Prompt.ask(f"[bold red]{prompt}[/bold red] (type '[bold]{phrase}[/bold]')")
    return typed.strip() == phrase
