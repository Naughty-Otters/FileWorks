"""OCR callback API routes and strategy integration tests."""

from __future__ import annotations

import io
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api.routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.core.config import Settings
from app.processing.decision import PriorityFallbackDecisionMaker
from app.processing.strategy.reader.priority import PriorityFallbackReaderOrdering
from app.services.options import ExtractOptions
from app.processing.ocr import (
    DefaultOcrRoutingStrategy,
    OcrRoute,
    resolve_unified_ocr_server_url,
)
from app.processing.strategy.ocr.liteparse_plan import build_liteparse_attempts
from app.processing.strategy.ocr.models import OcrAssessment, OcrPlan
from app.processing.strategy.reader.llm import llm_vision_ready
from app.services.easyocr_bridge import resolve_easyocr_ocr_server_url
from app.services.liteparse_ocr_bridge import resolve_paddle_ocr_server_url
from app.services.unified_ocr import markdown_is_weak, run_unified_ocr_for_liteparse


def _guest_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("anonymous"), anonymous_id="anonuser1"
    )
    return app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (40, 20), color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class OcrCallbackRouteTests(unittest.TestCase):
    def test_fast_endpoint_returns_results(self) -> None:
        client = TestClient(_guest_app())
        fake = [{"text": "Hello from fast chain with enough length", "bbox": [0, 0, 10, 5], "confidence": 0.9}]
        with patch("app.api.routes.run_fast_ocr_chain", return_value=(fake, "easyocr")):
            res = client.post(
                "/api/ocr/fast",
                files={"file": ("page.png", _png_bytes(), "image/png")},
                data={"language": "en"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(len(body["results"]), 1)
        self.assertEqual(body["results"][0]["text"], fake[0]["text"])

    def test_deep_endpoint_returns_results(self) -> None:
        client = TestClient(_guest_app())
        fake = [{"text": "Paddle deep chain output with sufficient characters", "bbox": [1, 2, 3, 4], "confidence": 0.8}]
        with patch("app.api.routes.run_deep_ocr_chain", return_value=(fake, "paddle")):
            res = client.post(
                "/api/ocr/deep",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["results"][0]["text"], fake[0]["text"])

    def test_unified_endpoint_returns_results(self) -> None:
        client = TestClient(_guest_app())
        fake = [{"text": "Unified OCR callback with enough readable text", "bbox": [0, 0, 5, 5], "confidence": 0.7}]
        with patch("app.api.routes.run_unified_ocr_for_liteparse", return_value=(fake, "easyocr")):
            res = client.post(
                "/api/ocr",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()["results"]), 1)

    def test_ocr_endpoints_reject_empty_upload(self) -> None:
        client = TestClient(_guest_app())
        for path in ("/api/ocr", "/api/ocr/fast", "/api/ocr/deep"):
            res = client.post(path, files={"file": ("empty.png", b"", "image/png")})
            self.assertEqual(res.status_code, 400, path)

    def test_fast_endpoint_503_when_chain_unavailable(self) -> None:
        client = TestClient(_guest_app())
        with patch("app.api.routes.run_fast_ocr_chain", side_effect=RuntimeError("no backends")):
            res = client.post(
                "/api/ocr/fast",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 503)


class OcrUrlResolutionTests(unittest.TestCase):
    def test_unified_external_microservice(self) -> None:
        url = resolve_unified_ocr_server_url(
            Settings(ocr_unified_server_url="https://ocr.internal/api/ocr")
        )
        self.assertEqual(url, "https://ocr.internal/api/ocr")

    def test_unified_legacy_liteparse_url(self) -> None:
        url = resolve_unified_ocr_server_url(
            Settings(liteparse_ocr_server_url="https://legacy.example/ocr")
        )
        self.assertEqual(url, "https://legacy.example/ocr")

    def test_ocr_fast_priority_over_legacy_easyocr(self) -> None:
        url = resolve_easyocr_ocr_server_url(
            Settings(
                ocr_fast_server_url="https://new-fast.example/fast",
                easyocr_ocr_server_url="https://legacy.example/fast",
            )
        )
        self.assertEqual(url, "https://new-fast.example/fast")

    def test_legacy_easyocr_url_when_fast_unset(self) -> None:
        url = resolve_easyocr_ocr_server_url(
            Settings(easyocr_ocr_server_url="https://legacy.example/fast")
        )
        self.assertEqual(url, "https://legacy.example/fast")

    def test_paddle_resolve_points_to_unified_local(self) -> None:
        url = resolve_paddle_ocr_server_url(Settings(liteparse_use_paddle_ocr=True))
        self.assertTrue(url.endswith("/api/ocr"))

    def test_custom_unified_skips_fast_deep_split(self) -> None:
        settings = Settings(ocr_unified_server_url="https://external.example/ocr")
        assessment = OcrAssessment(needs_ocr=True, pages=[])
        attempts = build_liteparse_attempts(OcrRoute.FAST, assessment, settings)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].name, "custom")
        self.assertEqual(attempts[0].ocr_server_url, "https://external.example/ocr")


class OcrRoutingStrategyTests(unittest.TestCase):
    def test_deep_route_when_prefer_structure(self) -> None:
        from app.processing.models import SourceFile

        strategy = DefaultOcrRoutingStrategy()
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        with patch(
            "app.processing.strategy.ocr.routing.assess_source",
            return_value=OcrAssessment(needs_ocr=True, pages=[], source="image"),
        ):
            plan = strategy.plan(
                source,
                ExtractOptions(prefer_structure=True),
                settings=Settings(paddle_ocr_enabled=True, liteparse_use_paddle_ocr=True),
            )
        self.assertEqual(plan.route, OcrRoute.DEEP)
        self.assertIn("deep", [a.name for a in plan.liteparse_attempts])

    def test_fast_route_by_default_for_scans(self) -> None:
        from app.processing.models import SourceFile

        strategy = DefaultOcrRoutingStrategy()
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        with patch(
            "app.processing.strategy.ocr.routing.assess_source",
            return_value=OcrAssessment(needs_ocr=True, pages=[], source="image"),
        ):
            plan = strategy.plan(source, ExtractOptions())
        self.assertEqual(plan.route, OcrRoute.FAST)

    def test_plan_metadata(self) -> None:
        assessment = OcrAssessment(needs_ocr=True, pages=[], source="image")
        plan = OcrPlan(route=OcrRoute.FAST, assessment=assessment, reason="test")
        meta = plan.to_metadata()
        self.assertEqual(meta["ocr_route"], "fast")
        self.assertTrue(meta["ocr_needs_ocr"])


class LegacyModuleReexportTests(unittest.TestCase):
    def test_decision_reexports_reader_ordering(self) -> None:
        self.assertIs(PriorityFallbackDecisionMaker, PriorityFallbackReaderOrdering)

    def test_processing_ocr_reexports_strategy(self) -> None:
        from app.processing.ocr import run_fast_ocr_chain as legacy_fast

        from app.processing.strategy.ocr.chains import run_fast_ocr_chain as strategy_fast

        self.assertIs(legacy_fast, strategy_fast)

    def test_unified_ocr_service_reexport(self) -> None:
        from app.services.unified_ocr import resolve_unified_ocr_server_url as svc_url

        from app.processing.strategy.ocr.chains import resolve_unified_ocr_server_url as chain_url

        self.assertIs(svc_url, chain_url)


class LlmVisionReadyTests(unittest.TestCase):
    def test_not_ready_without_provider(self) -> None:
        self.assertFalse(llm_vision_ready(Settings()))

    def test_ready_when_configured(self) -> None:
        settings = Settings(llm_provider="openai", llm_api_key="sk-test", llm_model="gpt-4o")
        with patch("app.engines.llm.LLMEngine.configured", return_value=True):
            with patch("app.engines.llm.LLMEngine.supports_vision", return_value=True):
                self.assertTrue(llm_vision_ready(settings))


class UnifiedOcrServiceTests(unittest.TestCase):
    def test_markdown_is_weak_reexport(self) -> None:
        from app.processing.strategy.ocr.quality import markdown_is_weak as strategy_weak

        self.assertIs(markdown_is_weak, strategy_weak)

    def test_run_unified_via_service_module(self) -> None:
        strong = [{"text": "Enough text from unified service reexport path"}]
        with patch(
            "app.processing.strategy.ocr.chains.run_paddle_ocr_for_liteparse",
            return_value=strong,
        ):
            with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=False):
                results, backend = run_unified_ocr_for_liteparse(
                    b"img",
                    settings=Settings(paddle_ocr_enabled=True, liteparse_use_paddle_ocr=True, upload_dir=Path("/tmp")),
                )
        self.assertTrue(backend.startswith("deep:"))


if __name__ == "__main__":
    unittest.main()
