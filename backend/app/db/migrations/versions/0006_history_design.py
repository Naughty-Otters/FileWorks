"""Add design fill flags to history summaries.

Revision ID: 0006_history_design
Revises: 0005_user_templates
Create Date: 2026-08-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0006_history_design"
down_revision: str | Sequence[str] | None = "0005_user_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "history_documents" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("history_documents")}
    if "has_design" not in columns:
        op.add_column(
            "history_documents",
            sa.Column("has_design", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if "design_template_id" not in columns:
        op.add_column(
            "history_documents",
            sa.Column("design_template_id", sa.String(length=128), nullable=True),
        )
    if "design_template_name" not in columns:
        op.add_column(
            "history_documents",
            sa.Column("design_template_name", sa.String(length=255), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "history_documents" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("history_documents")}
    if "design_template_name" in columns:
        op.drop_column("history_documents", "design_template_name")
    if "design_template_id" in columns:
        op.drop_column("history_documents", "design_template_id")
    if "has_design" in columns:
        op.drop_column("history_documents", "has_design")
