# Document processing architecture

Modular OO design for **reading** uploaded files and **exporting** user-edited content.

```
SourceFile
    │
    ▼
Reader.can_process()            # Text → Docling (prefer_structure) → AnyDoc → LLM → OCR
    │
    ▼
EngineDecisionMaker             # PriorityFallbackDecisionMaker
    │  ordered candidates
    ▼
Reader.read()                   # produces ReadResult
    │
    ▼
Quality gate                    # empty, or flat Markdown when prefer_structure
    │
    ▼
Postprocess                     # embed media → optional LLM structure edit → translate
    │
    ▼
DocumentOutput (default: Markdown; also Text / JSON)
    │
    ▼
FormatExporter                  # md | txt | html | json | (future)
    │
    ▼
ExportArtifact
```

## Reader priority

| Reader | id | priority | Role |
| --- | --- | --- | --- |
| Text | `text` | 5 | `.txt` / `.md` passthrough |
| Docling | `docling` | 8 | PDF / images when `prefer_structure` and the optional `docling` extra is installed |
| AnyDoc | `anydoc` | 10 | Office / CSV / PDF → Markdown. For PDFs with `prefer_structure`, tried after OCR (never disabled) |
| LLM | `llm` | 30 (configurable) | Vision LLM; skipped unless `LLM_PROVIDER` + API key and `use_ai` |
| OCR | `ocr` | 50 | Default: PP-OCR then PP-StructureV3. `prefer_structure`: Structure first |

Empty Markdown from an earlier reader triggers the next candidate. With `prefer_structure`, **flat** Markdown (long prose with no headings/lists/tables) also falls through, and PDFs try OCR/Docling before AnyDoc. Text files are never treated as flat. `LLMReader` is inactive until configured; then it runs after AnyDoc and before OCR (override with `LLM_PRIORITY`).

Install Docling with `uv sync --extra docling` (not in the default extra — it pulls layout models).

## Pages

Every reader must set ``page_count == len(pages)``. Each ``pages[]`` entry is
``{ "page": <1-based>, "markdown": "...", "json": ... }``. Multi-page Markdown is
joined with a thematic break (``---``).

| Reader | How pages are produced |
| --- | --- |
| Text | Always one page |
| Docling | Convert the whole PDF, then ``export_to_markdown(page_no=…)`` per page |
| AnyDoc | Office stays one flowing document. PDFs are split into single-page files and converted one page at a time |
| LLM | Vision models convert each rasterized PDF page. Native-PDF vendors (Claude) send the whole file and report ``source_page_count`` |
| OCR | Paddle ``predict()`` already yields one result per page |

``metadata.source_page_count`` is the true PDF length when the engine truncated or could not split content.

## Packages

| Package | Responsibility |
| --- | --- |
| `processing.models` | `SourceFile`, `Capability`, `ReadResult`, `DocumentOutput`, `ExportArtifact` |
| `processing.reading` | `Reader` ABC + Text / Docling / AnyDoc / LLM / OCR + `ReaderRegistry` |
| `processing.decision` | `EngineDecisionMaker` + `PriorityFallbackDecisionMaker` |
| `processing.export` | `FormatExporter` ABC + built-in exporters + registry |
| `processing.postprocess` | Media embed, structure edit, translation |
| `processing.pipeline` | `DocumentPipeline` facade used by the API |

## Adding a new reader

1. Subclass `Reader` in `processing/reading/`.
2. Implement `can_process(source) -> Capability` and `read(...) -> ReadResult`.
3. Register in `ReaderRegistry.default_readers()` (or `registry.register` at boot).
4. Set `priority` (lower = preferred when multiple readers claim the file).

The decision maker will include it automatically. On `read()` failure, empty Markdown, or (when `prefer_structure`) flat Markdown, the pipeline tries the next candidate.

## Adding a new export format

1. Subclass `FormatExporter` in `processing/export/`.
2. Implement `can_export` + `export`.
3. Register in `ExportRegistry.default_engines()`.

## Note on OCR / LLM providers

`OCRReader` calls Paddle providers under `app.engines` (`ocr` / `structure`).
`LLMReader` uses LangChain (`ChatOpenAI` / `ChatAnthropic`) via `app.engines.llm`
with a deploy-time provider (OpenRouter, Fireworks, DeepSeek, Kimi, GLM, OpenAI, Grok, Claude).
When `use_ai` is on and the winning reader is not `llm`, a text-only structure-edit pass can restore headings and tables.
See `backend/secrets/README.md` for API keys.
