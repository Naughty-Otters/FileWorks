"""Cooperative cancel tokens — the Lambda Stop path that process kill cannot cover."""

from __future__ import annotations

import contextlib
import threading
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.db.session import get_db
from app.lambda_worker import handler
from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.pipeline import DocumentPipeline
from app.processing.reading.base import Reader
from app.services.cancel_token import (
    cancel_key,
    cancel_scope,
    check_cancelled,
    clear_cancelled,
    is_cancelled,
    mark_cancelled,
    reset_local_tokens,
)
from app.services.options import ExtractOptions
from app.services.worker import ConversionCancelled


@contextlib.contextmanager
def _local_lock_cleared_memory_only():
    """Simulate another process: memory empty, file still on disk."""
    import app.services.cancel_token as ct

    with ct._local_lock:
        saved = dict(ct._local_tokens)
        ct._local_tokens.clear()
    try:
        yield
    finally:
        with ct._local_lock:
            ct._local_tokens.update(saved)


class CancelTokenStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_local_tokens()

    def tearDown(self) -> None:
        reset_local_tokens()

    def test_mark_and_check_local(self) -> None:
        self.assertFalse(is_cancelled("r1"))
        self.assertTrue(mark_cancelled("r1", owner="user:a", reason="stopped by the client"))
        self.assertTrue(is_cancelled("r1"))
        from app.services.cancel_token import _local_token_path

        path = _local_token_path("r1")
        self.assertIsNotNone(path)
        assert path is not None
        self.assertTrue(path.is_file())
        with self.assertRaises(ConversionCancelled) as caught:
            check_cancelled("r1", where="page 2/5")
        self.assertIn("page 2/5", str(caught.exception))
        clear_cancelled("r1")
        self.assertFalse(is_cancelled("r1"))
        self.assertFalse(path.is_file())

    def test_child_process_sees_parent_token_via_filesystem(self) -> None:
        """Local mode writes a file; a fresh check (no in-memory state) still sees it."""
        mark_cancelled("cross-proc")
        with _local_lock_cleared_memory_only():
            self.assertTrue(is_cancelled("cross-proc"))
        clear_cancelled("cross-proc")

    def test_scope_binds_active_run(self) -> None:
        mark_cancelled("scoped")
        with cancel_scope("scoped"):
            with self.assertRaises(ConversionCancelled):
                check_cancelled(where="inside scope")
        check_cancelled(where="outside")

    def test_s3_mark_and_head(self) -> None:
        settings = SimpleNamespace(storage_backend="s3", s3_bucket="hist", s3_region="us-east-1")
        put = MagicMock()
        head = MagicMock()
        client = MagicMock()
        client.put_object = put
        client.head_object = head

        with patch("app.core.config.get_settings", return_value=settings), patch(
            "boto3.client", return_value=client
        ):
            self.assertTrue(mark_cancelled("rid", reason="stop"))
            put.assert_called_once()
            self.assertEqual(put.call_args.kwargs["Bucket"], "hist")
            self.assertEqual(put.call_args.kwargs["Key"], cancel_key("rid"))
            self.assertTrue(is_cancelled("rid"))
            head.assert_called_once()


class CancelTokenStopsPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_local_tokens()

    def tearDown(self) -> None:
        reset_local_tokens()

    def test_pipeline_leaves_before_the_next_reader(self) -> None:
        class First(Reader):
            id = "first"
            label = "First"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.yes("yes")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                mark_cancelled("pipe-run")
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="")],
                )

        class Second(Reader):
            id = "second"
            label = "Second"
            priority = 2

            def can_process(self, source, options=None):
                return Capability.yes("yes")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                raise AssertionError("second reader must not run after cancel")

        from app.processing.reading.registry import ReaderRegistry

        registry = ReaderRegistry()
        registry.register(First())
        registry.register(Second())
        pipeline = DocumentPipeline(readers=registry)
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.png"
            path.write_bytes(b"png")
            source = SourceFile.from_path(path)
            with cancel_scope("pipe-run"):
                with self.assertRaises(ConversionCancelled):
                    pipeline.read(source, options=ExtractOptions())


class LambdaWorkerCancelTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_local_tokens()

    def tearDown(self) -> None:
        reset_local_tokens()

    def test_handler_returns_cancelled_when_token_is_set(self) -> None:
        mark_cancelled("lambda-run")
        event = {
            "action": "convert",
            "bucket": "b",
            "key": "k",
            "result_bucket": "b",
            "result_key": "out.json",
            "filename": "x.pdf",
            "run_id": "lambda-run",
            "options": {},
        }
        s3 = MagicMock()
        s3.get_object.return_value = {"Body": MagicMock(read=lambda: b"%PDF")}
        with patch("boto3.client", return_value=s3), patch("app.core.config.get_settings") as settings_fn:
            settings_fn.return_value = SimpleNamespace(
                s3_region="us-east-1", storage_backend="local", upload_dir=Path("/tmp")
            )
            body = handler(event, None)
        self.assertFalse(body["ok"])
        self.assertTrue(body["cancelled"])
        self.assertIn("stopped", body["error"].lower())
        s3.put_object.assert_not_called()


class CancelEndpointWritesTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_local_tokens()

    def tearDown(self) -> None:
        reset_local_tokens()

    def test_cancel_writes_tombstone_even_without_a_local_run(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_principal] = lambda: principal
        app.dependency_overrides[get_db] = lambda: None
        client = TestClient(app)

        res = client.post("/api/extract/cancel", data={"run_id": "remote-only"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["stopped"], body)
        self.assertTrue(body["token_written"])
        self.assertFalse(body["killed"])
        self.assertTrue(is_cancelled("remote-only"))


class RemoteInvokePassesRunIdTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_local_tokens()

    def tearDown(self) -> None:
        reset_local_tokens()

    def test_payload_includes_run_id_and_maps_cancelled(self) -> None:
        from app.processing.remote_llm import invoke_remote_convert

        settings = SimpleNamespace(
            llm_lambda_function="fn",
            s3_bucket="hist",
            s3_region="us-east-1",
        )

        class FakePayload:
            def read(self) -> bytes:
                return b'{"ok": false, "cancelled": true, "error": "Conversion stopped by the client"}'

        client = MagicMock()
        client.invoke.return_value = {"Payload": FakePayload()}

        def capture_client(service, **kwargs):
            self.assertEqual(service, "lambda")
            return client

        with patch("app.processing.remote_llm.get_settings", return_value=settings), patch(
            "boto3.client", side_effect=capture_client
        ):
            with self.assertRaises(ConversionCancelled):
                invoke_remote_convert(
                    bucket="up",
                    key="k",
                    filename="a.pdf",
                    content_type="application/pdf",
                    output_format="both",
                    options=ExtractOptions(use_ai=True),
                    run_id="rid-1",
                )
        import json

        sent = json.loads(client.invoke.call_args.kwargs["Payload"].decode("utf-8"))
        self.assertEqual(sent["run_id"], "rid-1")

    def test_poll_raises_when_token_appears_while_invoke_blocks(self) -> None:
        from app.processing.remote_llm import invoke_remote_convert

        settings = SimpleNamespace(
            llm_lambda_function="fn",
            s3_bucket="hist",
            s3_region="us-east-1",
            storage_backend="local",
            upload_dir=Path("/tmp"),
        )

        def slow_invoke(**kwargs):
            time.sleep(2.0)
            return {"Payload": MagicMock(read=lambda: b'{"ok": true}')}

        client = MagicMock()
        client.invoke.side_effect = slow_invoke

        def mark_soon() -> None:
            time.sleep(0.3)
            mark_cancelled("poll-rid")

        threading.Thread(target=mark_soon, daemon=True).start()
        with patch("app.processing.remote_llm.get_settings", return_value=settings), patch(
            "app.processing.remote_llm._CANCEL_POLL_S", 0.1
        ), patch("boto3.client", return_value=client):
            with self.assertRaises(ConversionCancelled) as caught:
                invoke_remote_convert(
                    bucket="up",
                    key="k",
                    filename="a.pdf",
                    content_type="application/pdf",
                    output_format="both",
                    options=ExtractOptions(use_ai=True),
                    run_id="poll-rid",
                )
        self.assertIn("remote Lambda", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
