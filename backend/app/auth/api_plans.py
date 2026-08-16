from __future__ import annotations

from dataclasses import dataclass


ApiPlanId = str  # api_free | api_builder | api_scale | api_business


@dataclass(frozen=True)
class ApiPlan:
    id: ApiPlanId
    label: str
    credits_per_month: int
    max_keys: int


# Page credits for POST /api/v1/convert. Workspace file quotas are a separate product.
STANDARD_CREDITS_PER_PAGE = 1
AI_CREDITS_PER_PAGE = 3

API_PLANS: dict[str, ApiPlan] = {
    "api_free": ApiPlan(id="api_free", label="API Free", credits_per_month=100, max_keys=2),
    "api_builder": ApiPlan(id="api_builder", label="API Builder", credits_per_month=2000, max_keys=5),
    "api_scale": ApiPlan(id="api_scale", label="API Scale", credits_per_month=8000, max_keys=10),
    "api_business": ApiPlan(
        id="api_business", label="API Business", credits_per_month=20000, max_keys=20
    ),
}

API_PLAN_RANK = {"api_free": 0, "api_builder": 1, "api_scale": 2, "api_business": 3}
API_CHANGEABLE_PLANS = frozenset(API_PLANS)
API_PAID_PLANS = frozenset({"api_builder", "api_scale", "api_business"})
FALLBACK_API_PLAN = "api_free"


def get_api_plan(plan_id: str | None) -> ApiPlan:
    if not plan_id:
        return API_PLANS[FALLBACK_API_PLAN]
    return API_PLANS.get(plan_id, API_PLANS[FALLBACK_API_PLAN])


def is_api_plan(plan_id: str | None) -> bool:
    return (plan_id or "") in API_PLANS


def can_change_api_plan(current: str, target: str) -> bool:
    if target not in API_CHANGEABLE_PLANS:
        return False
    return target != current


def convert_credits(*, page_count: int, enhanced: bool) -> int:
    pages = max(1, int(page_count or 0))
    per_page = AI_CREDITS_PER_PAGE if enhanced else STANDARD_CREDITS_PER_PAGE
    return pages * per_page
