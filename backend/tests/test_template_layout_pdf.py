"""Layout parity + PDF smoke tests (no heavy app imports)."""

from __future__ import annotations

import unittest

from app.processing.template.layout import apply_full_layout
from app.processing.template.render import render_html, render_pdf
from app.processing.template.runtime import auto_layout
from app.processing.template.schema import DesignDocument


def _sample() -> DesignDocument:
    return DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 400, "h": 500},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 400,
                "h": 500,
                "layout": {
                    "direction": "column",
                    "gap": 8,
                    "padding": 16,
                    "align": "stretch",
                    "justify": "start",
                },
                "children": [
                    {
                        "id": "h1",
                        "kind": "heading",
                        "label": "Hello",
                        "level": 1,
                        "x": 0,
                        "y": 0,
                        "w": 100,
                        "h": 20,
                        "style": {"fontSize": 24, "bold": True},
                    },
                    {
                        "id": "p1",
                        "kind": "paragraph",
                        "label": "World " * 40,
                        "x": 0,
                        "y": 0,
                        "w": 360,
                        "h": 20,
                        "style": {"fontSize": 12},
                    },
                ],
            },
            "variables": [],
        }
    )


class TemplateLayoutPdfTests(unittest.TestCase):
    def test_auto_layout_grows_text(self) -> None:
        laid, _warnings = auto_layout(_sample())
        self.assertGreater(laid.root.children[1].h, 20)

    def test_apply_full_layout_matches_auto_layout(self) -> None:
        a = apply_full_layout(_sample())
        b, _ = auto_layout(_sample())
        self.assertEqual(a.root.children[1].h, b.root.children[1].h)

    def test_render_pdf_bytes(self) -> None:
        laid = apply_full_layout(_sample())
        data = render_pdf(laid, title="Smoke")
        self.assertTrue(data.startswith(b"%PDF"))
        self.assertIn("position:absolute", render_html(laid))


if __name__ == "__main__":
    unittest.main()
