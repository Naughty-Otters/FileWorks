"""Corner and negative-case tests for OCR strategy, chains, and callbacks."""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api.routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.core.config import Settings
from app.processing.models import SourceFile
from app.processing.reading.base import Reader
from app.processing.strategy.ocr import (
    DefaultOcrRoutingStrategy,
    OcrRoute,
    build_liteparse_attempts,
    markdown_is_weak,
    ocr_results_are_weak,
    pick_best_parse_result,
    resolve_deep_ocr_server_url,
    resolve_fast_ocr_server_url,
    resolve_unified_ocr_server_url,
    run_deep_ocr_chain,
    run_fast_ocr_chain,
    run_unified_ocr_for_liteparse,
)
from app.processing.strategy.ocr.assess import assess_source
from app.processing.strategy.ocr.chains import _first_url, _local_ocr_callback_url
from app.processing.strategy.ocr.models import OcrAssessment, PageOcrAssessment
from app.processing.strategy.reader.llm import llm_vision_ready
from app.processing.strategy.reader.priority import PriorityFallbackReaderOrdering
from app.services.easyocr_bridge import normalize_easyocr_language
from app.services.liteparse_ocr_bridge import (
    _format_paddle_json,
    normalize_ocr_language,
    resolve_liteparse_ocr_server_url,
)
from app.services.options import ExtractOptions
from app.services.surya_bridge import run_surya_for_liteparse, surya_is_available


def _guest_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("anonymous"), anonymous_id="anonuser1"
    )
    return app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (10, 10), color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class UrlResolutionCornerTests(unittest.TestCase):
    def test_whitespace_urls_treated_as_unset(self) -> None:
        settings = Settings(
            ocr_fast_server_url="   ",
            ocr_deep_server_url="  ",
            ocr_unified_server_url="\t",
            liteparse_ocr_server_url="",
        )
        self.assertTrue(resolve_fast_ocr_server_url(settings).endswith("/api/ocr/fast"))
        self.assertTrue(resolve_deep_ocr_server_url(settings).endswith("/api/ocr/deep"))
        self.assertTrue(resolve_unified_ocr_server_url(settings).endswith("/api/ocr"))

    def test_unified_prefers_ocr_unified_over_legacy_liteparse(self) -> None:
        url = resolve_unified_ocr_server_url(
            Settings(
                ocr_unified_server_url="https://unified.example/ocr",
                liteparse_ocr_server_url="https://legacy.example/ocr",
            )
        )
        self.assertEqual(url, "https://unified.example/ocr")

    def test_local_url_uses_port_env(self) -> None:
        with patch.dict(os.environ, {"PORT": "9001"}):
            self.assertEqual(_local_ocr_callback_url("/api/ocr/fast"), "http://127.0.0.1:9001/api/ocr/fast")

    def test_first_url_helper(self) -> None:
        self.assertEqual(_first_url(None, "  https://x  ", None), "https://x")
        self.assertIsNone(_first_url(None, "  ", None))


class LiteparsePlanCornerTests(unittest.TestCase):
    def test_easyocr_disabled_skips_fast_attempt(self) -> None:
        settings = Settings(easyocr_enabled=False, paddle_ocr_enabled=True, liteparse_use_paddle_ocr=True)
        assessment = OcrAssessment(needs_ocr=True, pages=[])
        attempts = build_liteparse_attempts(OcrRoute.FAST, assessment, settings)
        self.assertEqual([a.name for a in attempts], ["tesseract", "deep"])

    def test_no_deep_backends_skips_deep_attempt(self) -> None:
        settings = Settings(
            easyocr_enabled=True,
            liteparse_use_paddle_ocr=False,
            surya_enabled=False,
        )
        assessment = OcrAssessment(needs_ocr=True, pages=[])
        attempts = build_liteparse_attempts(OcrRoute.DEEP, assessment, settings)
        self.assertEqual([a.name for a in attempts], ["tesseract", "fast"])

    def test_text_route_only_tesseract(self) -> None:
        settings = Settings()
        assessment = OcrAssessment(needs_ocr=False, pages=[])
        attempts = build_liteparse_attempts(OcrRoute.TEXT, assessment, settings)
        self.assertEqual([a.name for a in attempts], ["tesseract"])

    def test_pick_best_raises_when_no_attempts(self) -> None:
        with self.assertRaises(RuntimeError):
            pick_best_parse_result([], needs_ocr=True)

    def test_pick_best_returns_first_when_not_needs_ocr(self) -> None:
        first = SimpleNamespace(text="a")
        second = SimpleNamespace(text="b")
        attempts = [("text", None, first), ("fast", "http://x", second)]
        result, tier, url = pick_best_parse_result(attempts, needs_ocr=False)
        self.assertEqual(result, first)
        self.assertEqual(tier, "text")

    def test_pick_best_returns_last_when_all_weak(self) -> None:
        weak1 = SimpleNamespace(text="x")
        weak2 = SimpleNamespace(text="y")
        attempts = [("tesseract", None, weak1), ("fast", "http://x/fast", weak2)]
        result, tier, _ = pick_best_parse_result(attempts, needs_ocr=True)
        self.assertEqual(result, weak2)
        self.assertEqual(tier, "fast")


class QualityCornerTests(unittest.TestCase):
    def test_markdown_is_weak_none_and_empty(self) -> None:
        self.assertTrue(markdown_is_weak(None))  # type: ignore[arg-type]
        self.assertTrue(markdown_is_weak(""))
        self.assertTrue(markdown_is_weak("   "))

    def test_markdown_weak_when_long_but_low_alnum(self) -> None:
        punctuation = "..." * 30
        self.assertTrue(markdown_is_weak(punctuation))

    def test_markdown_custom_min_chars(self) -> None:
        text = "abcdefghijabcdefghij"  # 20 alnum chars
        self.assertTrue(markdown_is_weak(text, min_chars=40))
        self.assertFalse(markdown_is_weak(text, min_chars=20))

    def test_ocr_results_weak_skips_blank_text_entries(self) -> None:
        results = [{"text": ""}, {"text": "   "}, {"text": "ok"}]
        self.assertTrue(ocr_results_are_weak(results))

    def test_ocr_results_strong_enough(self) -> None:
        results = [{"text": "This line has enough readable characters"}]
        self.assertFalse(ocr_results_are_weak(results))


class AssessCornerTests(unittest.TestCase):
    def test_pdf_text_layer_probe_failure_falls_through(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
            source = SourceFile.from_path(Path(handle.name), filename="bad.pdf")
            with patch(
                "app.processing.strategy.ocr.assess.pdf_majority_has_text",
                side_effect=RuntimeError("corrupt"),
            ):
                with patch(
                    "app.processing.strategy.ocr.assess._liteparse_complexity",
                    return_value=None,
                ):
                    assessment = assess_source(source, use_liteparse_complexity=True)
        self.assertTrue(assessment.needs_ocr)
        self.assertEqual(assessment.source, "default")

    def test_complexity_no_ocr_pages(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
            source = SourceFile.from_path(Path(handle.name), filename="digital.pdf")
            pages = [
                PageOcrAssessment(page_number=1, needs_ocr=False, reasons=("text",)),
                PageOcrAssessment(page_number=2, needs_ocr=False, reasons=("text",)),
            ]
            with patch(
                "app.processing.strategy.ocr.assess._liteparse_complexity",
                return_value=pages,
            ):
                assessment = assess_source(source, use_liteparse_complexity=True)
        self.assertFalse(assessment.needs_ocr)
        self.assertEqual(assessment.ocr_page_count, 0)

    def test_complexity_mixed_pages_counts_ocr_pages(self) -> None:
        pages = [
            PageOcrAssessment(page_number=1, needs_ocr=False),
            PageOcrAssessment(page_number=2, needs_ocr=True),
        ]
        assessment = OcrAssessment(needs_ocr=True, pages=pages)
        self.assertEqual(assessment.ocr_page_count, 1)

    def test_strategy_text_route_when_complexity_says_no_ocr(self) -> None:
        strategy = DefaultOcrRoutingStrategy()
        source = SourceFile(path=Path("doc.pdf"), filename="doc.pdf", suffix=".pdf")
        with patch(
            "app.processing.strategy.ocr.routing.assess_source",
            return_value=OcrAssessment(needs_ocr=False, pages=[], source="liteparse_complexity"),
        ):
            plan = strategy.plan(source, ExtractOptions())
        self.assertEqual(plan.route, OcrRoute.TEXT)
        self.assertEqual(plan.liteparse_attempts[0].name, "text")


class ChainNegativeTests(unittest.TestCase):
    def test_fast_chain_no_backends_raises(self) -> None:
        with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=False):
            with self.assertRaises(RuntimeError) as ctx:
                run_fast_ocr_chain(
                    b"img",
                    settings=Settings(easyocr_enabled=True, upload_dir=Path("/tmp")),
                )
        self.assertIn("fast", str(ctx.exception).lower())

    def test_fast_chain_backend_exception_fails_chain(self) -> None:
        with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=True):
            with patch(
                "app.processing.strategy.ocr.chains.run_easyocr_for_liteparse",
                side_effect=RuntimeError("boom"),
            ):
                with self.assertRaises(RuntimeError):
                    run_fast_ocr_chain(
                        b"img",
                        settings=Settings(easyocr_enabled=True, upload_dir=Path("/tmp")),
                    )

    def test_deep_chain_no_backends_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            run_deep_ocr_chain(
                b"img",
                settings=Settings(
                    liteparse_use_paddle_ocr=False,
                    surya_enabled=False,
                    upload_dir=Path("/tmp"),
                ),
            )

    def test_deep_chain_paddle_fails_surya_not_wired(self) -> None:
        weak = [{"text": "x"}]
        with patch("app.processing.strategy.ocr.chains.run_paddle_ocr_for_liteparse", return_value=weak):
            with patch("app.processing.strategy.ocr.chains.surya_is_available", return_value=True):
                with patch(
                    "app.processing.strategy.ocr.chains.run_surya_for_liteparse",
                    side_effect=RuntimeError("not wired"),
                ):
                    results, backend = run_deep_ocr_chain(
                        b"img",
                        settings=Settings(
                            paddle_ocr_enabled=True,
                            liteparse_use_paddle_ocr=True,
                            surya_enabled=True,
                            upload_dir=Path("/tmp"),
                        ),
                    )
        self.assertEqual(backend, "paddle")
        self.assertEqual(results, weak)

    def test_unified_fast_unavailable_uses_deep(self) -> None:
        strong = [{"text": "Deep chain rescued unified path with enough text"}]
        with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=False):
            with patch("app.processing.strategy.ocr.chains.run_paddle_ocr_for_liteparse", return_value=strong):
                results, backend = run_unified_ocr_for_liteparse(
                    b"img",
                    settings=Settings(paddle_ocr_enabled=True, liteparse_use_paddle_ocr=True, upload_dir=Path("/tmp")),
                )
        self.assertTrue(backend.startswith("deep:"))

    def test_unified_both_chains_fail_raises(self) -> None:
        with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=False):
            with patch(
                "app.processing.strategy.ocr.chains.run_paddle_ocr_for_liteparse",
                side_effect=RuntimeError("paddle down"),
            ):
                with self.assertRaises(RuntimeError):
                    run_unified_ocr_for_liteparse(
                        b"img",
                        settings=Settings(paddle_ocr_enabled=True, liteparse_use_paddle_ocr=True, upload_dir=Path("/tmp")),
                    )


class OcrCallbackRouteNegativeTests(unittest.TestCase):
    def test_deep_endpoint_503(self) -> None:
        client = TestClient(_guest_app())
        with patch("app.api.routes.run_deep_ocr_chain", side_effect=RuntimeError("no deep")):
            res = client.post(
                "/api/ocr/deep",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 503)

    def test_unified_endpoint_503(self) -> None:
        client = TestClient(_guest_app())
        with patch(
            "app.api.routes.run_unified_ocr_for_liteparse",
            side_effect=RuntimeError("unavailable"),
        ):
            res = client.post(
                "/api/ocr",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 503)

    def test_fast_endpoint_500_on_unexpected_error(self) -> None:
        client = TestClient(_guest_app())
        with patch("app.api.routes.run_fast_ocr_chain", side_effect=ValueError("unexpected")):
            res = client.post(
                "/api/ocr/fast",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 500)

    def test_deep_endpoint_500_on_unexpected_error(self) -> None:
        client = TestClient(_guest_app())
        with patch("app.api.routes.run_deep_ocr_chain", side_effect=ValueError("unexpected")):
            res = client.post(
                "/api/ocr/deep",
                files={"file": ("page.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(res.status_code, 500)


class EasyOcrModelDirTests(unittest.TestCase):
    def tearDown(self) -> None:
        import app.services.easyocr_bridge as bridge

        bridge._reader = None
        bridge._reader_language = None

    def test_uses_baked_model_dir_without_download(self) -> None:
        import app.services.easyocr_bridge as bridge
        from app.services.easyocr_bridge import run_easyocr_for_liteparse

        bridge._reader = None
        bridge._reader_language = None
        settings = Settings(easyocr_model_dir="/var/task/.cache/easyocr", easyocr_use_gpu=False)
        fake_reader = MagicMock()
        fake_reader.readtext.return_value = []
        fake_mod = MagicMock()
        fake_mod.Reader.return_value = fake_reader
        with patch.dict("sys.modules", {"easyocr": fake_mod}):
            run_easyocr_for_liteparse(_png_bytes(), language="en", settings=settings)
        fake_mod.Reader.assert_called_once()
        kwargs = fake_mod.Reader.call_args.kwargs
        self.assertEqual(kwargs["model_storage_directory"], "/var/task/.cache/easyocr")
        self.assertFalse(kwargs["download_enabled"])


class BridgeCornerTests(unittest.TestCase):
    def test_normalize_ocr_language_aliases(self) -> None:
        self.assertEqual(normalize_ocr_language("zh-CN"), "ch")
        self.assertEqual(normalize_ocr_language(""), "en")
        self.assertEqual(normalize_easyocr_language("zh-hans"), "ch_sim")

    def test_format_paddle_json_empty_and_invalid(self) -> None:
        self.assertEqual(_format_paddle_json({}), [])
        self.assertEqual(_format_paddle_json({"rec_texts": ["", "  "], "rec_scores": [0.9, 0.8]}), [])
        self.assertEqual(len(_format_paddle_json(None)), 0)
        only_hi = _format_paddle_json({"rec_texts": ["", "hi"], "rec_scores": [0.9, 0.8]})
        self.assertEqual(len(only_hi), 1)
        self.assertEqual(only_hi[0]["text"], "hi")

    def test_format_paddle_json_pages_wrapper(self) -> None:
        payload = {"pages": [{"rec_texts": ["A"], "rec_scores": [0.9], "rec_boxes": [[0, 0, 1, 1]]}]}
        results = _format_paddle_json(payload)
        self.assertEqual(results[0]["text"], "A")

    def test_resolve_liteparse_url_none_when_paddle_disabled(self) -> None:
        url = resolve_liteparse_ocr_server_url(
            Settings(liteparse_use_paddle_ocr=False, liteparse_ocr_server_url=None)
        )
        self.assertIsNone(url)

    def test_surya_disabled_raises(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            run_surya_for_liteparse(b"img", settings=Settings(surya_enabled=False))
        self.assertIn("disabled", str(ctx.exception).lower())

    def test_surya_not_installed_raises(self) -> None:
        with patch("app.services.surya_bridge.surya_is_available", return_value=False):
            with self.assertRaises(RuntimeError) as ctx:
                run_surya_for_liteparse(b"img", settings=Settings(surya_enabled=True))
        self.assertIn("not installed", str(ctx.exception).lower())


class ReaderOrderingCornerTests(unittest.TestCase):
    def test_no_capable_readers_returns_empty(self) -> None:
        skip = _DummyReader("skip", 10, supported=False)
        maker = PriorityFallbackReaderOrdering()
        source = SourceFile(path=Path("x.txt"), filename="x.txt", suffix=".txt")
        self.assertEqual(maker.decide(source, [skip]), [])

    def test_llm_not_ready_even_with_use_ai(self) -> None:
        llm = _DummyReader("llm", 30)
        liteparse = _DummyReader("liteparse", 35)
        maker = PriorityFallbackReaderOrdering()
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        settings = Settings(llm_priority_fallback=88)
        with patch("app.processing.strategy.reader.llm.llm_vision_ready", return_value=False):
            with patch(
                "app.processing.strategy.reader.priority.get_settings",
                return_value=settings,
            ):
                ordered = [
                    r.id
                    for r, _ in maker.decide(source, [llm, liteparse], ExtractOptions(use_ai=True))
                ]
        self.assertEqual(ordered, ["liteparse", "llm"])

    def test_llm_lambda_function_not_ready(self) -> None:
        settings = Settings(
            llm_provider="openai",
            llm_api_key="sk-test",
            llm_model="gpt-4o",
            llm_lambda_function="arn:aws:lambda:ocr",
        )
        self.assertFalse(llm_vision_ready(settings))


class _DummyReader(Reader):
    def __init__(self, reader_id: str, priority: int, *, supported: bool = True) -> None:
        self.id = reader_id
        self.label = reader_id
        self.priority = priority
        self._supported = supported

    def can_process(self, source, options=None):
        from app.processing.models import Capability

        del source, options
        return Capability.yes("ok") if self._supported else Capability.no("nope")

    def read(self, source, *, options=None, preferred_output=None):
        from app.processing.models import ReadResult

        del source, options, preferred_output
        return ReadResult(engine_id=self.id, engine_label=self.label)


if __name__ == "__main__":
    unittest.main()
