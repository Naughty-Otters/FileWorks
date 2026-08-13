# Document processing architecture

Modular OO design for **reading** uploaded files and **exporting** user-edited content.

```
SourceFile
    │
    ▼
Reader.can_process()            # AnyDoc → LLM (if configured) → OCR
    │
    ▼
EngineDecisionMaker             # PriorityFallbackDecisionMaker
    │  ordered candidates
    ▼
Reader.read()                   # produces ReadResult
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
| AnyDoc | `anydoc` | 10 | Office / PDF / CSV → Markdown |
| LLM | `llm` | 30 (configurable) | Vision LLM; skipped unless `LLM_PROVIDER` + API key |
| OCR | `ocr` | 50 | PP-OCR, then PP-StructureV3 internally |

Empty Markdown from an earlier reader triggers the next candidate. Inside `OCRReader`, empty/failed PP-OCR falls through to Structure. `LLMReader` is inactive until configured; then it runs after AnyDoc and before OCR (override with `LLM_PRIORITY`).

## Packages

| Package | Responsibility |
| --- | --- |
| `processing.models` | `SourceFile`, `Capability`, `ReadResult`, `DocumentOutput`, `ExportArtifact` |
| `processing.reading` | `Reader` ABC + AnyDoc / LLM / OCR readers + `ReaderRegistry` |
| `processing.decision` | `EngineDecisionMaker` + `PriorityFallbackDecisionMaker` |
| `processing.export` | `FormatExporter` ABC + built-in exporters + registry |
| `processing.pipeline` | `DocumentPipeline` facade used by the API |

## Adding a new reader

1. Subclass `Reader` in `processing/reading/`.
2. Implement `can_process(source) -> Capability` and `read(...) -> ReadResult`.
3. Register in `ReaderRegistry.default_readers()` (or `registry.register` at boot).
4. Set `priority` (lower = preferred when multiple readers claim the file).

The decision maker will include it automatically. On `read()` failure or empty Markdown, the pipeline tries the next candidate.

## Adding a new export format

1. Subclass `FormatExporter` in `processing/export/`.
2. Implement `can_export` + `export`.
3. Register in `ExportRegistry.default_engines()`.

## Note on OCR / LLM providers

`OCRReader` calls Paddle providers under `app.engines` (`ocr` → `structure`).
`LLMReader` uses LangChain (`ChatOpenAI` / `ChatAnthropic`) via `app.engines.llm`
with a deploy-time provider (OpenRouter, Fireworks, DeepSeek, Kimi, GLM, OpenAI, Grok, Claude).
See `backend/secrets/README.md` for API keys.
