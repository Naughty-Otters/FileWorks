from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    google_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    picture_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    plan: Mapped[str] = mapped_column(
        String(32), nullable=False, default="basic", server_default="basic"
    )
    api_plan: Mapped[str] = mapped_column(
        String(32), nullable=False, default="api_free", server_default="api_free"
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_api_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    history_indexed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")
    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="user")
    history_documents: Mapped[list["HistoryDocument"]] = relationship(back_populates="user")
    templates: Mapped[list["UserTemplate"]] = relationship(back_populates="user")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    user: Mapped[User] = relationship(back_populates="refresh_tokens")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False, default="API key")
    prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    last4: Mapped[str] = mapped_column(String(4), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    user: Mapped[User] = relationship(back_populates="api_keys")


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    anonymous_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True
    )

    __table_args__ = (Index("ix_usage_events_user_created", "user_id", "created_at"),)


class HistoryDocument(Base):
    """Sidebar summary. Blob payload stays in S3 / local storage."""

    __tablename__ = "history_documents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    engine: Mapped[str | None] = mapped_column(String(64), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_backend: Mapped[str] = mapped_column(String(16), nullable=False, default="s3")
    has_markdown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_json: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_design: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    design_template_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    design_template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user: Mapped[User] = relationship(back_populates="history_documents")

    __table_args__ = (Index("ix_history_documents_user_created", "user_id", "created_at"),)


class UserTemplate(Base):
    """User-owned template metadata. The design document is blob-backed."""

    __tablename__ = "user_templates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    variable_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_repeaters: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    storage_backend: Mapped[str] = mapped_column(String(16), nullable=False, default="s3")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    user: Mapped[User] = relationship(back_populates="templates")

    __table_args__ = (Index("ix_user_templates_user_updated", "user_id", "updated_at"),)
