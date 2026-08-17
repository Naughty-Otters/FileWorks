# Document processing architecture

Modular OO design for **reading** uploaded files and **exporting** user-edited content.

```
SourceFile
    │
    ▼
ReadStage (Readers)             # Text → Docling (prefer_structure) → AnyDoc → LLM → OCR
    │                           # recognition only — never re-invoked later
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

## Reader priority

| Reader | id | priority | Role |
| --- | --- | --- | --- |
| Text | `text` | 5 | `.txt` / `.md` passthrough |
| Docling | `docling` | 8 | PDF / images when `prefer_structure` and the optional `docling` extra is installed |
| AnyDoc | `anydoc` | 10 | Office / CSV / PDF → Markdown. For **scanned** PDFs with `prefer_structure`, tried after OCR (never disabled) |
| LLM | `llm` | 30 (configurable) | Vision LLM; skipped unless `LLM_PROVIDER` + API key and `use_ai` |
| OCR | `ocr` | 50 | Default: PP-OCR then PP-StructureV3. `prefer_structure`: Structure first. PDFs with a majority text layer return that layer instead of running Paddle |

Empty Markdown from an earlier reader triggers the next candidate. With `prefer_structure`, **flat** Markdown also falls through, and scanned PDFs try OCR/Docling before AnyDoc. Text files are never treated as flat. `LLMReader` is inactive until configured; then it runs after AnyDoc and before OCR (override with `LLM_PRIORITY`).

`prefer_structure` does **not** demote AnyDoc for PDFs that carry their own text
layer. Those never reach PP-StructureV3 — `OCRReader` returns the text layer
verbatim, which has no headings or tables — so demoting AnyDoc there would make
the toggle yield flatter output than leaving it off.

Flatness means no headings and no tables; list markers only count as structure
when they are a real share of the lines, since raw text dumps routinely contain
stray lines that merely open like list items.

Install Docling with `uv sync --extra docling` (not in the default extra — it pulls layout models).

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
| `processing.decision` | `EngineDecisionMaker` + `PriorityFallbackDecisionMaker` |
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
