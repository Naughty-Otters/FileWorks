from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from datetime import date

from fw.costing import (  # noqa: E402
    estimate_monthly,
    format_usd,
    load_env_settings,
    parse_tfvars,
    resolve_cost_period,
    series_from_ce_results,
    services_from_ce_results,
)


class ParseTfvarsTests(unittest.TestCase):
    def test_scalars_lists_and_comments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "prod.tfvars"
            path.write_text(
                "\n".join(
                    [
                        '# comment',
                        'environment = "prod"',
                        "lambda_memory_mb = 3008",
                        "enable_nat_gateway = true",
                        "lambda_provisioned_min = 1",
                        "lambda_provisioned_max = 20",
                        'cors_origins = [',
                        '  "https://fileworks.ai",',
                        '  "http://localhost:3000",',
                        "]",
                    ]
                ),
                encoding="utf-8",
            )
            parsed = parse_tfvars(path)
        self.assertEqual(parsed["environment"], "prod")
        self.assertEqual(parsed["lambda_memory_mb"], 3008)
        self.assertTrue(parsed["enable_nat_gateway"])
        self.assertEqual(parsed["lambda_provisioned_min"], 1)
        self.assertEqual(parsed["cors_origins"], ["https://fileworks.ai", "http://localhost:3000"])


class EstimateTests(unittest.TestCase):
    def test_prod_like_settings_have_nat_rds_endpoints_and_floor(self) -> None:
        settings = {
            "aws_region": "us-east-1",
            "lambda_memory_mb": 3008,
            "lambda_provisioned_min": 1,
            "lambda_provisioned_max": 20,
            "db_instance_class": "db.t4g.micro",
            "enable_nat_gateway": True,
        }
        breakdown = estimate_monthly("prod", settings)
        by_name = {line.name: line for line in breakdown.lines}
        self.assertGreater(by_name["NAT Gateway"].monthly_usd, 30)
        self.assertGreater(by_name["RDS Postgres"].monthly_usd, 10)
        self.assertGreater(by_name["VPC Interface endpoints"].monthly_usd, 80)
        self.assertGreater(by_name["Lambda provisioned (floor)"].monthly_usd, 30)
        self.assertGreater(by_name["Lambda provisioned (scale-out ceiling)"].monthly_usd, 500)
        self.assertGreater(breakdown.fixed_total, 150)
        self.assertEqual(format_usd(0), "$0.00")

    def test_nat_off_and_no_provisioned(self) -> None:
        settings = {
            "enable_nat_gateway": False,
            "lambda_provisioned_min": 0,
            "lambda_provisioned_max": 0,
            "db_instance_class": "db.t4g.micro",
        }
        breakdown = estimate_monthly("dev", settings)
        by_name = {line.name: line for line in breakdown.lines}
        self.assertEqual(by_name["NAT Gateway"].monthly_usd, 0.0)
        self.assertEqual(by_name["Lambda provisioned (floor)"].monthly_usd, 0.0)
        self.assertEqual(by_name["Lambda provisioned (scale-out ceiling)"].monthly_usd, 0.0)

    def test_load_env_settings_merges_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "staging.tfvars"
            local = Path(tmp) / "staging.local.tfvars"
            base.write_text('lambda_provisioned_min = 1\nenable_nat_gateway = true\n', encoding="utf-8")
            local.write_text("enable_nat_gateway = false\n", encoding="utf-8")
            settings = load_env_settings(base, local)
        self.assertEqual(settings["lambda_provisioned_min"], 1)
        self.assertFalse(settings["enable_nat_gateway"])
        self.assertEqual(settings["lambda_memory_mb"], 3008)  # default


class CostExplorerHelpersTests(unittest.TestCase):
    def test_resolve_periods(self) -> None:
        today = date(2026, 8, 16)
        daily = resolve_cost_period("daily", today=today)
        self.assertEqual(daily.granularity, "DAILY")
        self.assertEqual(daily.start.isoformat(), "2026-08-02")
        self.assertEqual(daily.end.isoformat(), "2026-08-16")

        weekly = resolve_cost_period("weekly", today=today)
        self.assertEqual(weekly.granularity, "DAILY")
        self.assertEqual((today - weekly.start).days, 56)

        monthly = resolve_cost_period("monthly", today=today)
        self.assertEqual(monthly.granularity, "MONTHLY")
        self.assertEqual(monthly.start.day, 1)

    def test_weekly_rollup_and_services(self) -> None:
        results = [
            {
                "TimePeriod": {"Start": "2026-08-10", "End": "2026-08-11"},
                "Total": {"UnblendedCost": {"Amount": "1.50"}},
                "Groups": [
                    {
                        "Keys": ["AWS Lambda"],
                        "Metrics": {"UnblendedCost": {"Amount": "1.00"}},
                    },
                    {
                        "Keys": ["Amazon Relational Database Service"],
                        "Metrics": {"UnblendedCost": {"Amount": "0.50"}},
                    },
                ],
            },
            {
                "TimePeriod": {"Start": "2026-08-11", "End": "2026-08-12"},
                "Total": {"UnblendedCost": {"Amount": "2.00"}},
                "Groups": [
                    {
                        "Keys": ["AWS Lambda"],
                        "Metrics": {"UnblendedCost": {"Amount": "2.00"}},
                    },
                ],
            },
        ]
        series = series_from_ce_results("weekly", results)
        self.assertEqual(len(series), 1)
        self.assertAlmostEqual(series[0].amount, 3.5)
        self.assertTrue(series[0].label.endswith("W33") or "W" in series[0].label)

        daily = series_from_ce_results("daily", results)
        self.assertEqual([p.label for p in daily], ["2026-08-10", "2026-08-11"])

        services = services_from_ce_results(results)
        self.assertEqual(services[0][0], "AWS Lambda")
        self.assertAlmostEqual(services[0][1], 3.0)


if __name__ == "__main__":
    unittest.main()
