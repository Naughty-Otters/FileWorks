"""User template metadata.

Revision ID: 0005_user_templates
Revises: 0004_history_documents
Create Date: 2026-08-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "0005_user_templates"
down_revision: str | Sequence[str] | None = "0004_history_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if "user_templates" in set(inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "user_templates",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("page_label", sa.String(length=64), nullable=True),
        sa.Column("variable_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_repeaters", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("storage_backend", sa.String(length=16), nullable=False, server_default="s3"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_user_templates_user_updated",
        "user_templates",
        ["user_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_templates_user_updated", table_name="user_templates")
    op.drop_table("user_templates")
