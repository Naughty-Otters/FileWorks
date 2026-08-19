# Document processing architecture

Modular OO design for **reading** uploaded files and **exporting** user-edited content.

```
SourceFile
    │
    ▼
PrepareOcrInputStage            # resize / cap raster DPI before OCR readers
    │
    ▼
ReadStage (Readers)             # ReaderOrderingStrategy picks order (see processing.strategy)
    │                           # use_ai on: LLM (30) before LiteParse (35); off: LLM last (95)
    ▼
Postprocess                     # embed media → optional LLM structure edit → translate
    │
    ▼
NormalizeStage                  # engine JSON → StructureDocument (FileWorks IR)
    │
    ▼
FillStage                       # parse tables / formulas into filled blocks
    │
    ▼
ProjectStage                    # StructureDocument → markdown + regions (views)
    │
    ▼
API / Persist                   # structure + markdown (+ slim json)
    │
    ▼
ExportStage                     # structure-backed html/json/docx; md/txt from markdown
```

**Recognition invariant:** Normalize / Fill / Project / Export never call `Reader.read()`
or re-run OCR/Docling/LLM recognition. They only reshape what Read already produced.

## Pipeline config

Deploy-time enable/disable for every stage, reader, and OCR backend lives in
``processing/pipeline_config.py`` (`PipelineSpec.from_settings`). Per-request
``ExtractOptions`` overlay it and cannot turn on a disabled engine.

Inspect the live spec: ``GET /api/v1/convert`` → ``pipeline``.

Existing env flags map onto that spec (`PADDLE_OCR_ENABLED`, `LITEPARSE_ENABLED`,
`EASYOCR_ENABLED`, `SURYA_ENABLED`, `ANYDOC_ENABLED`, `DOCLING_ENABLED`, …).

## Reader priority

| Reader | id | priority | Role |
| --- | --- | --- | --- |
| Text | `text` | 5 | `.txt` / `.md` passthrough |
| Docling | `docling` | 8 | PDF / images when `prefer_structure` and the optional `docling` extra is installed |
| AnyDoc | `anydoc` | 10 | Office / CSV / PDF → Markdown. For **scanned** PDFs with `prefer_structure`, tried after OCR (never disabled) |
| LiteParse | `liteparse` | 35 (configurable) | Layout + `DefaultOcrRoutingStrategy` (fast/deep chains) |
| LLM | `llm` | 30 when `use_ai`; 95 fallback | Vision LLM; `use_ai` required for `can_process` |
| OCR | `ocr` | 50 | Paddle PP-OCR / Structure fallback reader |

Empty Markdown from an earlier reader triggers the next candidate. With `prefer_structure`, **flat** Markdown also falls through. `LLMReader` runs before LiteParse when `use_ai` and vision LLM are configured (`LLM_PRIORITY`, default 30). When `use_ai` is off, LLM is demoted to `LLM_PRIORITY_FALLBACK` (default 95) and is inactive unless `can_process` allows it.

`prefer_structure` does **not** demote AnyDoc for PDFs that carry their own text
layer. Those never reach PP-StructureV3 — `OCRReader` returns the text layer
verbatim, which has no headings or tables — so demoting AnyDoc there would make
the toggle yield flatter output than leaving it off.

Flatness means no headings and no tables; list markers only count as structure
when they are a real share of the lines, since raw text dumps routinely contain
stray lines that merely open like list items.

Install readers with `uv sync --all-extras` (Docling + LiteParse; Python 3.11–3.12).
The Lambda/Compose image uses the same extras from `[project.optional-dependencies]`
and prefetches Docling, EasyOCR, and Paddle weights into `/var/task/.cache` — the API VPC has
no NAT, so runtime must never download models.

## Strategy layer (`processing.strategy`)

See `processing/strategy/README.md` for the full diagram.

**Reader ordering** (`ReaderOrderingStrategy`): which reader runs first in the pipeline.

**OCR routing** (`OcrRoutingStrategy`): local OCR chains for LiteParse only (not LLM).

```
assess pages (text layer / LiteParse is_complex)
    │
    ├─ TEXT — embedded PDF text, no OCR
    ├─ FAST — LiteParse Tesseract → /api/ocr/fast (EasyOCR)
    └─ DEEP — escalate → /api/ocr/deep (Paddle PP-OCR → Surya)
```

LLM vision is **not** an OCR route — it is ordered by `ReaderOrderingStrategy` when `use_ai` is on.

**OCR callback API** (`/api/ocr/fast`, `/api/ocr/deep`, `/api/ocr`): internal LiteParse
per-page HTTP. Design: [docs/ocr-callback-api.md](../../../docs/ocr-callback-api.md).

| Package | Responsibility |
| --- | --- |
| `processing.strategy.reader` | `ReaderOrderingStrategy`, `PriorityFallbackReaderOrdering` |
| `processing.strategy.ocr` | `OcrRoutingStrategy`, assessments, fast/deep chains |
| `processing.decision` | Legacy re-export of reader strategies |
| `processing.ocr` | Legacy re-export of OCR strategies |

## Pages

Every reader must set ``page_count == len(pages)``. Each ``pages[]`` entry is
``{ "page": <1-based>, "markdown": "...", "json": ... }``. Multi-page Markdown is
joined with a thematic break (``---``). When a ``StructureDocument`` is present,
the API omits fat ``pages[].json`` by default (opt-in ``include_engine_json``).

## Packages

| Package | Responsibility |
| --- | --- |
| `processing.models` | `SourceFile`, `Capability`, `ReadResult`, `DocumentOutput`, `ExportArtifact` |
| `processing.reading` | `Reader` ABC + Text / Docling / AnyDoc / LLM / OCR + `ReaderRegistry` |
| `processing.strategy` | Reader ordering + OCR routing interfaces and defaults |
| `processing.structure` | `StructureDocument` IR, adapters, fill, project, render |
| `processing.stages` | `PipelineContext`, Normalize / Fill / Project stages |
| `processing.export` | `FormatExporter` ABC + built-in exporters + registry |
| `processing.postprocess` | Media embed, structure edit, translation |
| `processing.pipeline` | `DocumentPipeline` stage orchestrator used by the API |

## Adding a new reader

1. Subclass `Reader` in `processing/reading/`.
2. Implement `can_process(source) -> Capability` and `read(...) -> ReadResult`.
3. Register in `ReaderRegistry.default_readers()` (or `registry.register` at boot).
4. Set `priority` (lower = preferred when multiple readers claim the file).

The decision maker will include it automatically. On `read()` failure, empty Markdown, or (when `prefer_structure`) flat Markdown, the pipeline tries the next candidate.

## Adding a new export format

1. Subclass `FormatExporter` in `processing/export/`.
2. Implement `can_export` + `export` (accept optional `structure=`).
3. Register in `ExportRegistry.default_engines()`.

## Note on OCR / LLM providers

`OCRReader` calls Paddle providers under `app.engines` (`ocr` / `structure`).
`LLMReader` uses LangChain (`ChatOpenAI` / `ChatAnthropic`) via `app.engines.llm`
with a deploy-time provider (OpenRouter, Fireworks, DeepSeek, Kimi, GLM, OpenAI, Grok, Claude).
When `use_ai` is on and the winning reader is not `llm`, a text-only structure-edit pass can restore headings and tables.
See `backend/secrets/README.md` for API keys.
