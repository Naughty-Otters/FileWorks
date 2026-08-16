"""Workspace history summaries in Postgres.

Revision ID: 0004_history_documents
Revises: 0003_api_product
Create Date: 2026-08-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "0004_history_documents"
down_revision: Union[str, Sequence[str], None] = "0003_api_product"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "history_indexed" not in columns:
        op.add_column(
            "users",
            sa.Column("history_indexed", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        # Existing users need a one-time S3 backfill; new inserts default to indexed.
        op.alter_column(
            "users",
            "history_indexed",
            server_default=sa.true(),
        )

    tables = set(inspector.get_table_names())
    if "history_documents" not in tables:
        op.create_table(
            "history_documents",
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("engine", sa.String(length=64), nullable=True),
            sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("storage_backend", sa.String(length=16), nullable=False, server_default="s3"),
            sa.Column("has_markdown", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("has_json", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_history_documents_user_created",
            "history_documents",
            ["user_id", "created_at"],
        )


def downgrade() -> None:
    op.drop_index("ix_history_documents_user_created", table_name="history_documents")
    op.drop_table("history_documents")
    op.drop_column("users", "history_indexed")
