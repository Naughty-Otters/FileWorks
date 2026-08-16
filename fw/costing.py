"""Estimated monthly AWS cost breakdown for a FileWorks Terraform environment.

Prices are us-east-1 public list rates (approximate). Usage-based line items
(S3, Lambda on-demand GB-s, NAT data, CloudWatch ingest) are called out but
left at $0 in the fixed total — they depend on traffic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

# ~average hours in a month
HOURS_PER_MONTH = 730.0

# us-east-1 list prices (USD). Update when AWS changes public pricing.
PRICE_NAT_GATEWAY_HOUR = 0.045
PRICE_NAT_DATA_GB = 0.045  # informational only
PRICE_INTERFACE_ENDPOINT_HOUR = 0.01  # per AZ ENI
PRICE_RDS_T4G_MICRO_HOUR = 0.016
PRICE_RDS_GP3_GB_MONTH = 0.08
PRICE_SECRETS_MANAGER_SECRET_MONTH = 0.40
PRICE_LAMBDA_PROVISIONED_GB_SECOND = 0.0000041667  # x86
PRICE_ECR_GB_MONTH = 0.10  # informational; image size varies

INTERFACE_ENDPOINT_SERVICES = (
    "secretsmanager",
    "logs",
    "lambda",
    "ecr.api",
    "ecr.dkr",
    "sts",
)

DEFAULT_SETTINGS: dict[str, Any] = {
    "aws_region": "us-east-1",
    "lambda_memory_mb": 3008,
    "lambda_provisioned_min": 0,
    "lambda_provisioned_max": 0,
    "db_instance_class": "db.t4g.micro",
    "enable_nat_gateway": True,
    "ephemeral_storage_mb": 512,
}


@dataclass(frozen=True)
class CostLine:
    name: str
    monthly_usd: float
    detail: str
    category: str  # fixed | scale | usage


@dataclass(frozen=True)
class CostBreakdown:
    environment: str
    region: str
    settings: dict[str, Any]
    lines: tuple[CostLine, ...]
    notes: tuple[str, ...]

    @property
    def fixed_total(self) -> float:
        return sum(line.monthly_usd for line in self.lines if line.category == "fixed")

    @property
    def scale_ceiling(self) -> float:
        return sum(line.monthly_usd for line in self.lines if line.category == "scale")


def parse_tfvars(path: Path) -> dict[str, Any]:
    """Parse a simple Terraform .tfvars file (scalars + string lists)."""
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8")
    # Strip // comments and # comments (not inside strings — good enough for our tfvars).
    cleaned: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith("//"):
            continue
        if "#" in line:
            in_str = False
            out: list[str] = []
            for ch in line:
                if ch == '"':
                    in_str = not in_str
                if ch == "#" and not in_str:
                    break
                out.append(ch)
            line = "".join(out)
        cleaned.append(line)
    blob = "\n".join(cleaned)

    values: dict[str, Any] = {}
    for match in re.finditer(
        r'(?m)^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\[[^\]]*\]|"[^"]*"|true|false|-?\d+(?:\.\d+)?)',
        blob,
    ):
        key, raw = match.group(1), match.group(2).strip()
        values[key] = _parse_tfvars_value(raw)
    return values


def _parse_tfvars_value(raw: str) -> Any:
    if raw == "true":
        return True
    if raw == "false":
        return False
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        items: list[Any] = []
        for part in re.findall(r'"([^"]*)"|(-?\d+(?:\.\d+)?)|(true|false)', inner):
            if part[0] != "":
                items.append(part[0])
            elif part[1] != "":
                items.append(float(part[1]) if "." in part[1] else int(part[1]))
            else:
                items.append(part[2] == "true")
        return items
    if "." in raw:
        return float(raw)
    return int(raw)


def load_env_settings(tfvars_file: Path, local_tfvars_file: Path | None = None) -> dict[str, Any]:
    merged = dict(DEFAULT_SETTINGS)
    merged.update(parse_tfvars(tfvars_file))
    if local_tfvars_file is not None:
        merged.update(parse_tfvars(local_tfvars_file))
    return merged


def _rds_monthly(instance_class: str, storage_gb: int = 20) -> tuple[float, str]:
    storage = storage_gb * PRICE_RDS_GP3_GB_MONTH
    if instance_class == "db.t4g.micro":
        compute = PRICE_RDS_T4G_MICRO_HOUR * HOURS_PER_MONTH
        return compute + storage, f"{instance_class} + {storage_gb} GB gp3"
    # Unknown class: storage only + note
    return storage, f"{instance_class} (compute not priced — add rate); {storage_gb} GB gp3"


def _provisioned_monthly(memory_mb: int, units: int) -> float:
    if units <= 0:
        return 0.0
    gb = memory_mb / 1024.0
    return units * gb * PRICE_LAMBDA_PROVISIONED_GB_SECOND * 3600.0 * HOURS_PER_MONTH


def estimate_monthly(environment: str, settings: dict[str, Any]) -> CostBreakdown:
    region = str(settings.get("aws_region") or "us-east-1")
    memory = int(settings.get("lambda_memory_mb") or 3008)
    prov_min = int(settings.get("lambda_provisioned_min") or 0)
    prov_max = int(settings.get("lambda_provisioned_max") or 0)
    db_class = str(settings.get("db_instance_class") or "db.t4g.micro")
    nat = bool(settings.get("enable_nat_gateway", True))
    az_count = 2
    endpoint_count = len(INTERFACE_ENDPOINT_SERVICES)

    lines: list[CostLine] = []

    if nat:
        lines.append(
            CostLine(
                name="NAT Gateway",
                monthly_usd=PRICE_NAT_GATEWAY_HOUR * HOURS_PER_MONTH,
                detail=f"1× NAT @ ${PRICE_NAT_GATEWAY_HOUR}/hr (data @ ${PRICE_NAT_DATA_GB}/GB extra)",
                category="fixed",
            )
        )
    else:
        lines.append(
            CostLine(
                name="NAT Gateway",
                monthly_usd=0.0,
                detail="disabled (enable_nat_gateway=false)",
                category="fixed",
            )
        )

    rds_cost, rds_detail = _rds_monthly(db_class)
    lines.append(
        CostLine(
            name="RDS Postgres",
            monthly_usd=rds_cost,
            detail=rds_detail,
            category="fixed",
        )
    )

    endpoint_month = PRICE_INTERFACE_ENDPOINT_HOUR * HOURS_PER_MONTH * endpoint_count * az_count
    lines.append(
        CostLine(
            name="VPC Interface endpoints",
            monthly_usd=endpoint_month,
            detail=f"{endpoint_count} services × {az_count} AZs @ ${PRICE_INTERFACE_ENDPOINT_HOUR}/hr each",
            category="fixed",
        )
    )

    lines.append(
        CostLine(
            name="Secrets Manager",
            monthly_usd=PRICE_SECRETS_MANAGER_SECRET_MONTH,
            detail="1 secret (fileworks-<env>/app)",
            category="fixed",
        )
    )

    min_units = max(0, prov_min)
    lines.append(
        CostLine(
            name="Lambda provisioned (floor)",
            monthly_usd=_provisioned_monthly(memory, min_units),
            detail=(
                f"{min_units} unit(s) × {memory} MB API alias"
                if min_units
                else "disabled (lambda_provisioned_min=0)"
            ),
            category="fixed",
        )
    )

    extra_units = max(0, prov_max - min_units)
    lines.append(
        CostLine(
            name="Lambda provisioned (scale-out ceiling)",
            monthly_usd=_provisioned_monthly(memory, extra_units),
            detail=(
                f"up to +{extra_units} unit(s) if utilization stays high "
                f"(max={prov_max})"
                if extra_units
                else "no headroom above floor"
            ),
            category="scale",
        )
    )

    lines.append(
        CostLine(
            name="Lambda on-demand / S3 / logs / NAT data",
            monthly_usd=0.0,
            detail="usage-based — grows with conversions and traffic",
            category="usage",
        )
    )

    notes = (
        f"Region pricing table: {region} (us-east-1 list rates; other regions differ).",
        "Fixed total assumes provisioned concurrency stays at its minimum.",
        "Scale ceiling is the extra provisioned cost if autoscaling sits at max all month.",
        "Cloudflare Pages / Workers are billed by Cloudflare, not included here.",
        "LLM Lambda has no provisioned concurrency; its cost is on-demand only.",
    )
    return CostBreakdown(
        environment=environment,
        region=region,
        settings=settings,
        lines=tuple(lines),
        notes=notes,
    )


def format_usd(value: float) -> str:
    if abs(value) < 0.005:
        return "$0.00"
    return f"${value:,.2f}"


# --- Cost Explorer helpers -------------------------------------------------

COST_PERIODS = ("daily", "weekly", "monthly")


@dataclass(frozen=True)
class CostPeriodWindow:
    period: str
    granularity: str  # DAILY | MONTHLY
    start: date
    end: date  # exclusive, per Cost Explorer
    label: str


@dataclass(frozen=True)
class CostSeriesPoint:
    label: str
    amount: float


def resolve_cost_period(period: str, *, today: date | None = None) -> CostPeriodWindow:
    """Map daily/weekly/monthly to a Cost Explorer time window."""
    chosen = (period or "monthly").strip().lower()
    if chosen not in COST_PERIODS:
        raise ValueError(f"period must be one of {', '.join(COST_PERIODS)}")
    end = today or date.today()
    if chosen == "daily":
        start = end - timedelta(days=14)
        return CostPeriodWindow(chosen, "DAILY", start, end, "last 14 days (daily)")
    if chosen == "weekly":
        # Pull daily rows, then roll up to ISO weeks in Python.
        start = end - timedelta(days=56)
        return CostPeriodWindow(chosen, "DAILY", start, end, "last 8 weeks (weekly rollup)")
    start = date(end.year, end.month, 1) - timedelta(days=150)
    start = date(start.year, start.month, 1)
    return CostPeriodWindow(chosen, "MONTHLY", start, end, "last ~6 months (monthly)")


def parse_ce_amount(metrics: object) -> float:
    if not isinstance(metrics, dict):
        return 0.0
    raw = ((metrics.get("UnblendedCost") or {}).get("Amount")) or "0"
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def series_from_ce_results(period: str, results: list[dict[str, Any]]) -> list[CostSeriesPoint]:
    """Build a display series from Cost Explorer ResultsByTime (ungrouped totals)."""
    points: list[CostSeriesPoint] = []
    if period == "weekly":
        buckets: dict[str, float] = {}
        order: list[str] = []
        for result in results:
            time_period = result.get("TimePeriod") or {}
            start_raw = str(time_period.get("Start") or "")
            if not start_raw:
                continue
            day = date.fromisoformat(start_raw[:10])
            iso_year, iso_week, _ = day.isocalendar()
            label = f"{iso_year}-W{iso_week:02d}"
            amount = parse_ce_amount(result.get("Total") or {})
            if label not in buckets:
                order.append(label)
                buckets[label] = 0.0
            buckets[label] += amount
        return [CostSeriesPoint(label, buckets[label]) for label in order]

    for result in results:
        time_period = result.get("TimePeriod") or {}
        start_raw = str(time_period.get("Start") or "")
        if not start_raw:
            continue
        day = date.fromisoformat(start_raw[:10])
        if period == "monthly":
            label = day.strftime("%Y-%m")
        else:
            label = day.isoformat()
        points.append(CostSeriesPoint(label, parse_ce_amount(result.get("Total") or {})))
    return points


def services_from_ce_results(results: list[dict[str, Any]]) -> list[tuple[str, float]]:
    """Sum service groups across the whole window."""
    totals: dict[str, float] = {}
    for result in results:
        for group in result.get("Groups") or []:
            if not isinstance(group, dict):
                continue
            keys = group.get("Keys") or ["unknown"]
            name = str(keys[0])
            amount = parse_ce_amount(group.get("Metrics") or {})
            if amount < 0.005:
                continue
            totals[name] = totals.get(name, 0.0) + amount
    return sorted(totals.items(), key=lambda item: item[1], reverse=True)
