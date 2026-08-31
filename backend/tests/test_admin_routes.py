from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.admin_routes import router as admin_router
from app.auth.admin import ADMIN_EMAIL, is_admin_email
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.db.models import Base, User
from app.db.session import get_db


def test_admin_email_is_kenny_only() -> None:
    assert ADMIN_EMAIL == "kenny.zlee@gmail.com"
    assert is_admin_email("kenny.zlee@gmail.com")
    assert is_admin_email("Kenny.Zlee@Gmail.com")
    assert not is_admin_email("other@example.com")
    assert not is_admin_email(None)


def _app(session: Session, email: str) -> tuple[TestClient, User]:
    user_id = uuid4()
    user = User(
        id=user_id,
        email=email,
        google_sub=f"sub-{email}",
        name="Admin Test",
        plan="basic",
        api_plan="api_free",
    )
    session.add(user)
    session.flush()

    other = User(
        id=uuid4(),
        email="target@example.com",
        google_sub="sub-target",
        name="Target",
        plan="basic",
        api_plan="api_free",
    )
    session.add(other)
    session.flush()

    principal_user = SimpleNamespace(
        id=user_id,
        email=email,
        plan="basic",
        api_plan="api_free",
        name="Admin Test",
        picture_url=None,
    )
    principal = Principal(plan=get_plan("basic"), user=principal_user)  # type: ignore[arg-type]

    app = FastAPI()
    app.include_router(admin_router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: session
    return TestClient(app), other


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


def test_non_admin_forbidden(db_session: Session) -> None:
    client, _ = _app(db_session, "member@example.com")
    res = client.get("/api/admin/users")
    assert res.status_code == 403


def test_admin_lists_and_updates_plans(db_session: Session) -> None:
    client, other = _app(db_session, ADMIN_EMAIL)

    overview = client.get("/api/admin/overview")
    assert overview.status_code == 200
    assert overview.json()["users"] == 2

    listed = client.get("/api/admin/users")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 2
    assert any(item["email"] == "target@example.com" for item in body["items"])

    patched = client.patch(
        f"/api/admin/users/{other.id}",
        json={"plan": "premium", "api_plan": "api_scale"},
    )
    assert patched.status_code == 200, patched.text
    payload = patched.json()
    assert payload["plan"] == "premium"
    assert payload["api_plan"] == "api_scale"

    db_session.refresh(other)
    assert other.plan == "premium"
    assert other.api_plan == "api_scale"


def test_admin_rejects_invalid_plan(db_session: Session) -> None:
    client, other = _app(db_session, ADMIN_EMAIL)
    res = client.patch(f"/api/admin/users/{other.id}", json={"plan": "anonymous"})
    assert res.status_code == 400


def test_admin_get_user_and_plans(db_session: Session) -> None:
    client, other = _app(db_session, ADMIN_EMAIL)

    plans = client.get("/api/admin/plans")
    assert plans.status_code == 200
    body = plans.json()
    assert any(p["id"] == "basic" for p in body["workspace_plans"])
    assert any(p["id"] == "api_free" for p in body["api_plans"])

    detail = client.get(f"/api/admin/users/{other.id}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["email"] == "target@example.com"
    assert "quota" in payload
    assert "api_quota" in payload


def test_admin_search_filters_users(db_session: Session) -> None:
    client, _ = _app(db_session, ADMIN_EMAIL)
    res = client.get("/api/admin/users", params={"q": "target@"})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert all("target" in item["email"] for item in body["items"])


def test_admin_unauthenticated(db_session: Session) -> None:
    app = FastAPI()
    app.include_router(admin_router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("anonymous"), anonymous_id="anon"
    )
    app.dependency_overrides[get_db] = lambda: db_session
    client = TestClient(app)
    res = client.get("/api/admin/overview")
    assert res.status_code == 401


def test_me_exposes_is_admin_flag(db_session: Session) -> None:
    from app.api.auth_routes import router as auth_router

    admin = User(
        id=uuid4(),
        email=ADMIN_EMAIL,
        google_sub="sub-admin-me",
        name="Admin",
        plan="basic",
        api_plan="api_free",
    )
    member = User(
        id=uuid4(),
        email="member@example.com",
        google_sub="sub-member-me",
        name="Member",
        plan="basic",
        api_plan="api_free",
    )
    db_session.add(admin)
    db_session.add(member)
    db_session.flush()

    app = FastAPI()
    app.include_router(auth_router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db_session

    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("basic"), user=admin
    )
    admin_res = TestClient(app).get("/api/me")
    assert admin_res.status_code == 200
    assert admin_res.json()["is_admin"] is True

    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("basic"), user=member
    )
    member_res = TestClient(app).get("/api/me")
    assert member_res.status_code == 200
    assert member_res.json()["is_admin"] is False

    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("anonymous"), anonymous_id="anon"
    )
    guest_res = TestClient(app).get("/api/me")
    assert guest_res.status_code == 200
    assert guest_res.json()["is_admin"] is False
