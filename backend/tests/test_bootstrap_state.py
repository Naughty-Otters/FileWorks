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

from fw.context import ENVIRONMENTS, Context, Session  # noqa: E402
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
    def test_account_state_path_is_namespaced(self) -> None:
        directory = Path("/tmp/bootstrap")
        self.assertEqual(
            bootstrap_state_path("722972110637", directory),
            directory / "terraform.722972110637.tfstate",
        )

    def test_matching_legacy_state_is_migrated(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            legacy = directory / "terraform.tfstate"
            backup = directory / "terraform.tfstate.backup"
            _write_state(legacy, "fileworks-tfstate-444179576826")
            backup.write_text("backup")

            target = prepare_bootstrap_state("444179576826", directory)

            self.assertEqual(target.name, "terraform.444179576826.tfstate")
            self.assertTrue(target.exists())
            self.assertFalse(legacy.exists())
            self.assertEqual(
                (directory / "terraform.444179576826.tfstate.backup").read_text(),
                "backup",
            )

    def test_foreign_legacy_state_is_left_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            legacy = directory / "terraform.tfstate"
            _write_state(legacy, "fileworks-tfstate-444179576826")

            target = prepare_bootstrap_state("722972110637", directory)

            self.assertEqual(target.name, "terraform.722972110637.tfstate")
            self.assertFalse(target.exists())
            self.assertTrue(legacy.exists())

    def test_existing_account_state_wins_over_legacy(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            target = directory / "terraform.722972110637.tfstate"
            target.write_text("current")
            legacy = directory / "terraform.tfstate"
            _write_state(legacy, "fileworks-tfstate-722972110637")

            selected = prepare_bootstrap_state("722972110637", directory)

            self.assertEqual(selected, target)
            self.assertEqual(target.read_text(), "current")
            self.assertTrue(legacy.exists())

    def test_bootstrap_apply_uses_selected_account_state(self) -> None:
        ctx = Context(
            env=ENVIRONMENTS["prod"],
            session=Session(
                profile="default",
                region="us-east-1",
                account_id="722972110637",
                arn="arn:aws:iam::722972110637:user/zhenqi",
            ),
        )
        selected = Path("/tmp/bootstrap/terraform.722972110637.tfstate")
        with patch("fw.tools.require_cmd"), patch(
            "fw.tools.prepare_bootstrap_state", return_value=selected
        ), patch("fw.tools.run") as run:
            bootstrap_state(ctx)

        apply_args = run.call_args_list[1].args[0]
        self.assertIn("-state=terraform.722972110637.tfstate", apply_args)
        self.assertIn("-backup=terraform.722972110637.tfstate.backup", apply_args)
        self.assertIn("-var=state_bucket=fileworks-tfstate-722972110637", apply_args)


if __name__ == "__main__":
    unittest.main()
