from __future__ import annotations

"""Convert API plan credits and page caps.

Numeric quotas must stay aligned with frontend/src/lib/plan-quotas.ts
(API_QUOTAS). Change both when adjusting AI credits or standard page caps.
"""

from dataclasses import dataclass


ApiPlanId = str  # api_free | api_builder | api_scale | api_business


@dataclass(frozen=True)
class ApiPlan:
    id: ApiPlanId
    label: str
    credits_per_month: int  # AI / translation / Design auto-fill pages
    standard_pages_per_month: int  # default convert, 0 AI credits
    max_keys: int


# POST /api/v1/convert. Standard convert is free (page cap only). AI is 1 credit / page.
STANDARD_CREDITS_PER_PAGE = 0
AI_CREDITS_PER_PAGE = 1

API_PLANS: dict[str, ApiPlan] = {
    "api_free": ApiPlan(
        id="api_free",
        label="API Free",
        credits_per_month=2,
        standard_pages_per_month=500,
        max_keys=1,
    ),
    "api_builder": ApiPlan(
        id="api_builder",
        label="API Daily",
        credits_per_month=100,
        standard_pages_per_month=5000,
        max_keys=5,
    ),
    "api_scale": ApiPlan(
        id="api_scale",
        label="API Expert",
        credits_per_month=1000,
        standard_pages_per_month=20000,
        max_keys=20,
    ),
    "api_business": ApiPlan(
        id="api_business",
        label="API Business",
        credits_per_month=2000,
        standard_pages_per_month=40000,
        max_keys=20,
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


def _pages(page_count: int) -> int:
    return max(1, int(page_count or 0))


def convert_credits(*, page_count: int, enhanced: bool) -> int:
    if not enhanced:
        return 0
    return _pages(page_count) * AI_CREDITS_PER_PAGE


def convert_standard_pages(*, page_count: int, enhanced: bool) -> int:
    if enhanced:
        return 0
    return _pages(page_count)
