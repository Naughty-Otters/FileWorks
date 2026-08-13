from __future__ import annotations

from dataclasses import dataclass


PlanId = str  # anonymous | basic | pro | premium


@dataclass(frozen=True)
class Plan:
    id: PlanId
    label: str
    extract: bool
    full_result: bool
    ai: bool
    translate: bool
    history: bool
    export: bool
    extracts_per_day: int | None  # None = unlimited
    extracts_per_month: int | None


PLANS: dict[str, Plan] = {
    "anonymous": Plan(
        id="anonymous",
        label="Guest",
        extract=False,
        full_result=False,
        ai=False,
        translate=False,
        history=False,
        export=True,
        extracts_per_day=None,
        extracts_per_month=None,
    ),
    "basic": Plan(
        id="basic",
        label="Basic",
        extract=True,
        full_result=True,
        ai=False,
        translate=False,
        history=True,
        export=True,
        extracts_per_day=1,
        extracts_per_month=None,
    ),
    "pro": Plan(
        id="pro",
        label="Pro",
        extract=True,
        full_result=True,
        ai=True,
        translate=True,
        history=True,
        export=True,
        extracts_per_day=None,
        extracts_per_month=500,
    ),
    "premium": Plan(
        id="premium",
        label="Premium",
        extract=True,
        full_result=True,
        ai=True,
        translate=True,
        history=True,
        export=True,
        extracts_per_day=None,
        extracts_per_month=1000,
    ),
}


def get_plan(plan_id: str | None) -> Plan:
    if not plan_id:
        return PLANS["anonymous"]
    return PLANS.get(plan_id, PLANS["anonymous"])


PLAN_RANK = {"anonymous": 0, "basic": 1, "pro": 2, "premium": 3}
CHANGEABLE_PLANS = frozenset({"basic", "pro", "premium"})


def can_change_plan(current: str, target: str) -> bool:
    if target not in CHANGEABLE_PLANS:
        return False
    return target != current


def permissions_for(plan: Plan) -> dict[str, bool]:
    return {
        "extract": plan.extract,
        "extract.full_result": plan.full_result,
        "extract.ai": plan.ai,
        "extract.translate": plan.translate,
        "history.read": plan.history,
        "history.write": plan.history,
        "export": plan.export,
    }
