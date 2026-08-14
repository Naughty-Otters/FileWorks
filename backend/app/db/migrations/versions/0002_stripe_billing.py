"""Stripe customer and subscription ids on users.

Revision ID: 0002_stripe_billing
Revises: 0001_initial_auth
Create Date: 2026-08-13
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0002_stripe_billing"
down_revision: Union[str, Sequence[str], None] = "0001_initial_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in inspect(bind).get_columns("users")}
    if "stripe_customer_id" not in columns:
        op.add_column("users", sa.Column("stripe_customer_id", sa.String(length=255), nullable=True))
        op.create_index("ix_users_stripe_customer_id", "users", ["stripe_customer_id"], unique=True)
    if "stripe_subscription_id" not in columns:
        op.add_column("users", sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "stripe_subscription_id")
    op.drop_index("ix_users_stripe_customer_id", table_name="users")
    op.drop_column("users", "stripe_customer_id")
