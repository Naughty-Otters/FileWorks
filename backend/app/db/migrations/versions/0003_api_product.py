"""API product: keys, credits, and a separate Stripe subscription.

Revision ID: 0003_api_product
Revises: 0002_stripe_billing
Create Date: 2026-08-15
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "0003_api_product"
down_revision: Union[str, Sequence[str], None] = "0002_stripe_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "api_plan" not in columns:
        op.add_column(
            "users",
            sa.Column("api_plan", sa.String(length=32), nullable=False, server_default="api_free"),
        )
    if "stripe_api_subscription_id" not in columns:
        op.add_column(
            "users",
            sa.Column("stripe_api_subscription_id", sa.String(length=255), nullable=True),
        )

    usage_columns = {col["name"] for col in inspector.get_columns("usage_events")}
    if "credits" not in usage_columns:
        op.add_column(
            "usage_events",
            sa.Column("credits", sa.Integer(), nullable=False, server_default="0"),
        )

    tables = set(inspector.get_table_names())
    if "api_keys" not in tables:
        op.create_table(
            "api_keys",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("prefix", sa.String(length=24), nullable=False),
            sa.Column("last4", sa.String(length=4), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
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
        op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_api_keys_user_id", table_name="api_keys")
    op.drop_table("api_keys")
    op.drop_column("usage_events", "credits")
    op.drop_column("users", "stripe_api_subscription_id")
    op.drop_column("users", "api_plan")
