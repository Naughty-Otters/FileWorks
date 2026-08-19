"""Engine-agnostic extract options and per-provider adapters."""

from __future__ import annotations

from typing import Any, Literal

from pydantic.dataclasses import dataclass

OptionKey = Literal[
    "use_ai",
    "prefer_structure",
    "preserve_images",
    "ocr_high_quality",
    "use_doc_preprocessor",
    "use_seal_recognition",
    "use_table_recognition",
    "use_formula_recognition",
    "use_chart_recognition",
    "use_region_detection",
    "format_block_content",
]

OPTION_KEYS: tuple[OptionKey, ...] = (
    "use_ai",
    "prefer_structure",
    "preserve_images",
    "ocr_high_quality",
    "use_doc_preprocessor",
    "use_seal_recognition",
    "use_table_recognition",
    "use_formula_recognition",
    "use_chart_recognition",
    "use_region_detection",
    "format_block_content",
)

SupportLevel = Literal["native", "approx"]


@dataclass
class ExtractOptions:
    """Per-request document parsing toggles shared by every OCR engine."""

    use_ai: bool = False
    prefer_structure: bool = False
    preserve_images: bool = True
    ocr_high_quality: bool = False
    use_doc_preprocessor: bool = False
    use_seal_recognition: bool = False
    use_table_recognition: bool = True
    use_formula_recognition: bool = False
    use_chart_recognition: bool = False
    use_region_detection: bool = True
    format_block_content: bool = True
    # Empty / "original" skips the translation post-process.
    target_lang: str = ""

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {key: bool(getattr(self, key)) for key in OPTION_KEYS}
        payload["target_lang"] = self.normalized_target_lang()
        return payload

    def normalized_target_lang(self) -> str:
        value = (self.target_lang or "").strip()
        if value.lower() in {"", "original", "none", "off", "source", "keep"}:
            return ""
        return value

    def enabled_keys(self) -> list[OptionKey]:
        return [key for key in OPTION_KEYS if getattr(self, key)]

    def structure_predict_kwargs(self) -> dict[str, bool]:
        """Map UI options onto PPStructureV3.predict() kwargs."""
        return {
            "use_doc_orientation_classify": self.use_doc_preprocessor,
            "use_doc_unwarping": self.use_doc_preprocessor,
            "use_seal_recognition": self.use_seal_recognition,
            "use_table_recognition": self.use_table_recognition,
            "use_formula_recognition": self.use_formula_recognition,
            "use_chart_recognition": self.use_chart_recognition,
            "use_region_detection": self.use_region_detection,
            "format_block_content": self.format_block_content,
        }

    # Back-compat alias used by older call sites.
    def predict_kwargs(self) -> dict[str, bool]:
        return self.structure_predict_kwargs()

    def paddle_ocr_predict_kwargs(self) -> dict[str, Any]:
        """Map UI options onto PaddleOCR.predict() kwargs (+ region hint)."""
        return {
            "use_doc_orientation_classify": self.use_doc_preprocessor,
            "use_doc_unwarping": self.use_doc_preprocessor,
            # Word boxes help build region overlays when region detection is on.
            "return_word_box": self.use_region_detection,
        }

    @classmethod
    def from_form(
        cls,
        *,
        use_ai: bool = False,
        prefer_structure: bool = False,
        preserve_images: bool = True,
        ocr_high_quality: bool = False,
        use_doc_preprocessor: bool = False,
        use_seal_recognition: bool = False,
        use_table_recognition: bool = True,
        use_formula_recognition: bool = False,
        use_chart_recognition: bool = False,
        use_region_detection: bool = True,
        format_block_content: bool = True,
        target_lang: str = "",
    ) -> ExtractOptions:
        return cls(
            use_ai=use_ai,
            prefer_structure=prefer_structure,
            preserve_images=preserve_images,
            ocr_high_quality=ocr_high_quality,
            use_doc_preprocessor=use_doc_preprocessor,
            use_seal_recognition=use_seal_recognition,
            use_table_recognition=use_table_recognition,
            use_formula_recognition=use_formula_recognition,
            use_chart_recognition=use_chart_recognition,
            use_region_detection=use_region_detection,
            format_block_content=format_block_content,
            target_lang=target_lang,
        )


# What each engine does with every UI option (native API vs approximated post-process).
ENGINE_OPTION_SUPPORT: dict[str, dict[OptionKey, SupportLevel]] = {
    "structure": {key: "native" for key in OPTION_KEYS},
    "ocr": {
        "prefer_structure": "approx",
        "preserve_images": "approx",
        "ocr_high_quality": "native",
        "use_doc_preprocessor": "native",
        "use_seal_recognition": "approx",
        "use_table_recognition": "approx",
        "use_formula_recognition": "approx",
        "use_chart_recognition": "approx",
        "use_region_detection": "native",
        "format_block_content": "approx",
    },
}


DEFAULT_EXTRACT_OPTIONS = ExtractOptions()
