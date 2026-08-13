from __future__ import annotations

import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from PIL import Image

from app.auth.redact import redact_extract_payload
from app.processing.postprocess.media import (
    EmbeddedImage,
    expand_embedded_media,
    fold_embedded_media,
    normalize_image_bytes,
    place_images,
    protect_embedded_images,
    restore_embedded_images,
    to_data_url,
    _pdf_object_to_image,
)
from app.services.markdown import pick_best_markdown
from app.storage.local import LocalDocumentStore


def _jpeg(size: tuple[int, int] = (80, 80), color: tuple[int, int, int] = (40, 120, 80)) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


class MediaEmbedTests(unittest.TestCase):
    def test_skips_tiny_images(self) -> None:
        self.assertIsNone(normalize_image_bytes(_jpeg((16, 16)), "image/jpeg"))

    def test_place_replaces_alt_paragraph(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        markdown = place_images("Intro\n\nChart A\n\nOutro\n", [EmbeddedImage(alt="Chart A", data=data, mime=mime)])
        self.assertIn("![Chart A](data:image/jpeg;base64,", markdown)
        self.assertNotIn("\nChart A\n", markdown)

    def test_place_fills_existing_relative_ref(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        markdown = place_images(
            "See\n\n![fig](imgs/foo.jpg)\n",
            [EmbeddedImage(alt="other", data=data, mime=mime)],
        )
        self.assertIn("![fig](data:image/jpeg;base64,", markdown)
        self.assertNotIn("imgs/foo.jpg", markdown)

    def test_place_puts_appendix_after_heading(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        markdown = place_images(
            "Letterhead line\n\n# Renewal\n\n" + ("body paragraph\n\n" * 20),
            [EmbeddedImage(alt="logo", data=data, mime=mime, page=1)],
        )
        image_at = markdown.index("](data:image")
        last_body = markdown.rindex("body paragraph")
        self.assertLess(image_at, last_body)
        self.assertTrue(markdown.lstrip().startswith("## Embedded images"))

    def test_pdf_logo_keeps_layout_size_and_nearby_text(self) -> None:
        data, mime = normalize_image_bytes(_jpeg((426, 222)), "image/jpeg") or (b"", "")
        markdown = place_images(
            "Cover note\n\nVIRGINIA TAM INSURANCE AGENCY, INC.\n\nPolicy details follow.\n",
            [
                EmbeddedImage(
                    alt="page-1-image",
                    data=data,
                    mime=mime,
                    page=1,
                    display_width=136,
                    display_height=71,
                    y_frac=0.05,
                    x_frac=0.74,
                    page_hint="VIRGINIA TAM INSURANCE AGENCY, INC.",
                    page_count=21,
                )
            ],
        )
        self.assertIn('](data:image/jpeg;base64,', markdown)
        self.assertIn(' "136 right")', markdown)
        self.assertNotIn("<img", markdown)
        self.assertNotIn("## Embedded images", markdown)
        agency_line = next(line for line in markdown.splitlines() if "VIRGINIA TAM INSURANCE AGENCY" in line)
        self.assertIn("![", agency_line)

    def test_pdf_midpage_image_inserts_after_hint(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        markdown = place_images(
            "Intro\n\nDeclarations page summary here.\n\nClosing notes.\n",
            [
                EmbeddedImage(
                    alt="page-7-image",
                    data=data,
                    mime=mime,
                    page=7,
                    display_width=130,
                    display_height=48,
                    y_frac=0.69,
                    page_hint="Declarations page summary here.",
                    page_count=21,
                )
            ],
        )
        image_at = markdown.index("](data:image")
        hint_at = markdown.index("Declarations page summary here.")
        close_at = markdown.index("Closing notes.")
        self.assertGreater(image_at, hint_at)
        self.assertLess(image_at, close_at)
        self.assertNotIn("<img", markdown)

    def test_fold_expand_roundtrip(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        url = to_data_url(data, mime)
        original = f"# Title\n\n![fig]({url})\n"
        folded = fold_embedded_media(original, {"text": original}, [{"page": 1, "markdown": original}])
        self.assertIn("](media/0.jpg)", folded.markdown or "")
        self.assertEqual(len(folded.files), 1)
        files = {item.name: item.data for item in folded.files}
        markdown, json_data, pages = expand_embedded_media(
            folded.markdown, folded.json_data, folded.pages, files
        )
        self.assertEqual(markdown, original)
        self.assertEqual(json_data["text"], original)
        self.assertEqual(pages[0]["markdown"], original)

    def test_protect_keeps_sized_markdown_image(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        original = f'Hello ![x]({to_data_url(data, mime)} "136x71") world'
        protected, held = protect_embedded_images(original)
        self.assertIn("@@FWIMG0@@", protected)
        self.assertNotIn("data:image", protected)
        self.assertEqual(restore_embedded_images(protected, held), original)

    def test_normalize_converts_html_img_to_markdown(self) -> None:
        from app.processing.postprocess.media import normalize_embedded_images

        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        url = to_data_url(data, mime)
        markdown = normalize_embedded_images(
            f'<img src="{url}" alt="logo" width="136" height="71" />\n\nText\n'
        )
        self.assertNotIn("<img", markdown)
        self.assertIn("![logo](", markdown)
        self.assertIn(' "136x71")', markdown)

    def test_redact_keeps_whole_data_url(self) -> None:
        data, mime = normalize_image_bytes(_jpeg(), "image/jpeg") or (b"", "")
        url = to_data_url(data, mime)
        markdown = ("word " * 40) + f"\n\n![keep]({url})\n\n" + ("tail " * 40)
        redacted, _, _ = redact_extract_payload(markdown, {}, [])
        self.assertIsNotNone(redacted)
        assert redacted is not None
        if "data:image" in redacted:
            start = redacted.index("](data:")
            end = redacted.index(")", start)
            self.assertTrue(redacted[start:end].startswith("](data:image/jpeg;base64,"))

    def test_structure_rebuild_keeps_figure_markup(self) -> None:
        primary = "Intro\n\n![crop](imgs/fig.jpg)\n\nMore"
        payload = {
            "parsing_res_list": [
                {"block_label": "text", "block_content": "Intro", "block_order": 1},
                {"block_label": "image", "block_content": "caption", "block_order": 2},
                {"block_label": "paragraph_title", "block_content": "More", "block_order": 3},
            ]
        }
        chosen = pick_best_markdown(pipeline_markdown=primary, json_payload=payload)
        self.assertIn("caption", chosen)
        self.assertIn("crop omitted", chosen.lower())

    def test_local_store_media_roundtrip(self) -> None:
        jpeg = _jpeg()
        with TemporaryDirectory() as tmp:
            store = LocalDocumentStore(Path(tmp))
            store.save_document(
                document_id="doc1",
                filename="x.pdf",
                content_type="application/pdf",
                source_bytes=b"%PDF",
                source_suffix=".pdf",
                engine="anydoc",
                page_count=1,
                output_format="both",
                markdown="![a](media/0.jpg)",
                json_data={},
                pages=[],
            )
            store.save_media_files("doc1", [("0.jpg", jpeg, "image/jpeg")])
            loaded = store.load_media_files("doc1")
            self.assertEqual(loaded["0.jpg"], jpeg)

    def test_skips_full_page_pdf_xobject(self) -> None:
        obj = SimpleNamespace(
            get_bounds=lambda: (0, 0, 612, 792),
            get_px_size=lambda: (1200, 1600),
        )
        self.assertIsNone(_pdf_object_to_image(obj, 1, page_size=(612.0, 792.0)))

    def test_skips_tiny_on_page_pdf_xobject(self) -> None:
        obj = SimpleNamespace(
            get_bounds=lambda: (10, 10, 30, 25),
            get_px_size=lambda: (80, 60),
        )
        self.assertIsNone(_pdf_object_to_image(obj, 1, page_size=(612.0, 792.0)))


class AnyDocCollectTests(unittest.TestCase):
    def test_collects_inlines_in_order(self) -> None:
        from app.processing.reading.anydoc import _collect_document_images

        jpeg = _jpeg()
        asset = SimpleNamespace(id=0, media_type="image/jpeg", data=jpeg)
        source = SimpleNamespace(kind="asset", asset_id=0)
        inline = SimpleNamespace(kind="image", alt="Logo", source=source, content=None)
        para = SimpleNamespace(
            kind="paragraph",
            content=[inline],
            list=None,
            table=None,
            blocks=None,
        )
        document = SimpleNamespace(assets=[asset], blocks=[para], notes=[])
        images = _collect_document_images(document)
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0].alt, "Logo")


if __name__ == "__main__":
    unittest.main()
