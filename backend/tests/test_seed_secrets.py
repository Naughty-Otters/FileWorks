from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fw.context import (
    ENVIRONMENTS,
    SECRET_ENV_PREFIXES,
    SECRET_EXACT_KEYS,
    Context,
    resolve_public_api_url,
)


class SeedSecretTests(unittest.TestCase):
    def test_stripe_and_public_url_are_seeded(self) -> None:
        self.assertIn("STRIPE_", SECRET_ENV_PREFIXES)
        self.assertIn("GOOGLE_CLIENT_ID", SECRET_EXACT_KEYS)
        self.assertIn("PUBLIC_APP_URL", SECRET_EXACT_KEYS)
        parsed = {
            "STRIPE_SECRET_KEY": "sk_test_x",
            "STRIPE_WEBHOOK_SECRET": "whsec_x",
            "STRIPE_PRICE_PRO": "12",
            "PUBLIC_APP_URL": "https://fileworks-staging.pages.dev",
            "GOOGLE_CLIENT_ID": "cid.apps.googleusercontent.com",
            "DATABASE_URL": "postgresql://local",
            "EMPTY": "",
        }
        payload = {
            key: value
            for key, value in parsed.items()
            if value and (key in SECRET_EXACT_KEYS or key.startswith(SECRET_ENV_PREFIXES))
        }
        self.assertEqual(
            set(payload),
            {
                "STRIPE_SECRET_KEY",
                "STRIPE_WEBHOOK_SECRET",
                "STRIPE_PRICE_PRO",
                "PUBLIC_APP_URL",
                "GOOGLE_CLIENT_ID",
            },
        )

    def test_public_api_url_prefers_custom_host(self) -> None:
        self.assertEqual(
            resolve_public_api_url(
                "https://api.staging.fileworks.ai/",
                "https://abc.lambda-url.us-east-1.on.aws/",
            ),
            "https://api.staging.fileworks.ai",
        )
        self.assertEqual(
            resolve_public_api_url(
                "https://jqdn6zhecoyp6echd5vxxz6a3e0fhlix.lambda-url.us-east-1.on.aws",
                "https://api.staging.fileworks.ai",
            ),
            "https://api.staging.fileworks.ai",
        )
        self.assertEqual(
            resolve_public_api_url("", "https://abc.lambda-url.us-east-1.on.aws/"),
            "https://abc.lambda-url.us-east-1.on.aws",
        )
        self.assertEqual(resolve_public_api_url("", "  ", ""), "")

    def test_staging_public_origin(self) -> None:
        self.assertEqual(ENVIRONMENTS["staging"].public_origin, "https://staging.fileworks.ai")
        self.assertEqual(ENVIRONMENTS["staging"].api_origin, "https://api.staging.fileworks.ai")
        self.assertEqual(ENVIRONMENTS["prod"].public_origin, "https://fileworks.ai")
        self.assertEqual(ENVIRONMENTS["prod"].api_origin, "https://api.fileworks.ai")
        self.assertEqual(ENVIRONMENTS["dev"].public_origin, ENVIRONMENTS["dev"].pages_origin)
        self.assertEqual(ENVIRONMENTS["dev"].api_origin, "")
        self.assertTrue((ROOT / "infra/cloudflare/api-proxy/wrangler.jsonc").is_file())
        self.assertTrue((ROOT / "infra/cloudflare/api-proxy/src/index.js").is_file())
        local = Context(env=ENVIRONMENTS["staging"], scope="local")
        cloud = Context(env=ENVIRONMENTS["staging"], scope="cloud")
        self.assertFalse(local.is_cloud)
        self.assertTrue(cloud.is_cloud)
