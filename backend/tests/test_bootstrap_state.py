from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fw.context import (  # noqa: E402
    ENVIRONMENTS,
    Context,
    Session,
    app_bucket_name,
    terraform_state_key,
)
from fw.tools import (  # noqa: E402
    bootstrap_state,
    bootstrap_state_path,
    prepare_bootstrap_state,
)


def _write_state(path: Path, bucket: str) -> None:
    path.write_text(
        json.dumps(
            {
                "resources": [
                    {
                        "type": "aws_s3_bucket",
                        "name": "state",
                        "instances": [{"attributes": {"bucket": bucket}}],
                    }
                ]
            }
        )
    )


class BootstrapStateTests(unittest.TestCase):
    def test_app_bucket_and_state_key(self) -> None:
        self.assertEqual(app_bucket_name("staging"), "fileworks-stage")
        self.assertEqual(app_bucket_name(ENVIRONMENTS["prod"]), "fileworks-prod")
        self.assertEqual(
            terraform_state_key("722972110637"),
            "tfstate/722972110637/fileworks/terraform.tfstate",
        )

    def test_account_env_state_path_is_namespaced(self) -> None:
        directory = Path("/tmp/bootstrap")
        self.assertEqual(
            bootstrap_state_path("722972110637", "prod", directory),
            directory / "terraform.722972110637.prod.tfstate",
        )

    def test_matching_legacy_state_is_migrated(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            legacy = directory / "terraform.tfstate"
            backup = directory / "terraform.tfstate.backup"
            _write_state(legacy, "fileworks-prod")
            backup.write_text("backup")

            target = prepare_bootstrap_state("722972110637", "prod", directory)

            self.assertEqual(target.name, "terraform.722972110637.prod.tfstate")
            self.assertTrue(target.exists())
            self.assertFalse(legacy.exists())
            self.assertEqual(
                (directory / "terraform.722972110637.prod.tfstate.backup").read_text(),
                "backup",
            )

    def test_foreign_legacy_state_is_left_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            legacy = directory / "terraform.tfstate"
            _write_state(legacy, "fileworks-tfstate-444179576826")

            target = prepare_bootstrap_state("722972110637", "prod", directory)

            self.assertEqual(target.name, "terraform.722972110637.prod.tfstate")
            self.assertFalse(target.exists())
            self.assertTrue(legacy.exists())

    def test_account_only_state_for_app_bucket_is_promoted(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            account_only = directory / "terraform.722972110637.tfstate"
            _write_state(account_only, "fileworks-stage")

            target = prepare_bootstrap_state("722972110637", "staging", directory)

            self.assertEqual(target.name, "terraform.722972110637.staging.tfstate")
            self.assertTrue(target.exists())
            self.assertFalse(account_only.exists())

    def test_existing_env_state_wins(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            target = directory / "terraform.722972110637.prod.tfstate"
            target.write_text("current")
            legacy = directory / "terraform.tfstate"
            _write_state(legacy, "fileworks-prod")

            selected = prepare_bootstrap_state("722972110637", "prod", directory)

            self.assertEqual(selected, target)
            self.assertEqual(target.read_text(), "current")
            self.assertTrue(legacy.exists())

    def test_bootstrap_apply_uses_env_app_bucket(self) -> None:
        ctx = Context(
            env=ENVIRONMENTS["prod"],
            session=Session(
                profile="default",
                region="us-east-1",
                account_id="722972110637",
                arn="arn:aws:iam::722972110637:user/zhenqi",
            ),
        )
        selected = Path("/tmp/bootstrap/terraform.722972110637.prod.tfstate")
        with patch("fw.tools.require_cmd"), patch(
            "fw.tools.prepare_bootstrap_state", return_value=selected
        ), patch("fw.tools.run") as run:
            bootstrap_state(ctx)

        apply_calls = [
            call.args[0]
            for call in run.call_args_list
            if call.args and call.args[0][:2] == ["terraform", "apply"]
        ]
        self.assertEqual(len(apply_calls), 1)
        apply_args = apply_calls[0]
        self.assertIn("-state=terraform.722972110637.prod.tfstate", apply_args)
        self.assertIn("-backup=terraform.722972110637.prod.tfstate.backup", apply_args)
        self.assertIn("-var=state_bucket=fileworks-prod", apply_args)


if __name__ == "__main__":
    unittest.main()
