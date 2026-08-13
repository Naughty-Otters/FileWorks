"""Initial auth, refresh tokens, and usage events.

Revision ID: 0001_initial_auth
Revises:
Create Date: 2026-08-12
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_auth"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _table_names()
    if "users" not in existing:
        op.create_table(
            "users",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False, unique=True),
            sa.Column("google_sub", sa.String(length=255), nullable=False, unique=True),
            sa.Column("name", sa.String(length=255), nullable=True),
            sa.Column("picture_url", sa.Text(), nullable=True),
            sa.Column("plan", sa.String(length=32), nullable=False, server_default="basic"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
    if "refresh_tokens" not in existing:
        op.create_table(
            "refresh_tokens",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("token_hash"),
        )
    if "usage_events" not in existing:
        op.create_table(
            "usage_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("anonymous_id", sa.String(length=64), nullable=True),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        )
    op.create_index(
        "ix_refresh_tokens_user_id",
        "refresh_tokens",
        ["user_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_usage_events_user_id",
        "usage_events",
        ["user_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_usage_events_created_at",
        "usage_events",
        ["created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_usage_events_user_created",
        "usage_events",
        ["user_id", "created_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_usage_events_user_created", table_name="usage_events", if_exists=True)
    op.drop_index("ix_usage_events_created_at", table_name="usage_events", if_exists=True)
    op.drop_index("ix_usage_events_user_id", table_name="usage_events", if_exists=True)
    op.drop_table("usage_events")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens", if_exists=True)
    op.drop_table("refresh_tokens")
    op.drop_table("users")
