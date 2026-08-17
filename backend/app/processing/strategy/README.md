# Processing strategy layer

Server-side routing for **which reader runs first** and **which OCR chain runs per page**.
Clients upload via `POST /api/extract`; they do not pick backends.

## Layout

```
processing/strategy/
  reader/                    # Reader ordering (pipeline fallback order)
    base.py                  # ReaderOrderingStrategy ABC
    priority.py              # PriorityFallbackReaderOrdering
    llm.py                   # LLM vision readiness
  ocr/                       # Local OCR chains (LiteParse + HTTP callbacks)
    base.py                  # OcrRoutingStrategy ABC
    routing.py               # DefaultOcrRoutingStrategy
    assess.py                # Page-level OCR need
    chains.py                # Fast / deep chain runners
    liteparse_plan.py        # LiteParse parse attempts
    models.py                  # OcrPlan, OcrRoute, assessments
    quality.py                 # Weak-output heuristics
```

Legacy import paths `processing.decision` and `processing.ocr` re-export from here.

## End-to-end flow

```mermaid
flowchart TB
    subgraph upload [Client upload]
        EX["POST /api/extract"]
    end

    subgraph prep [Prepare]
        OCRPREP["PrepareOcrInputStage\nresize / DPI cap"]
    end

    subgraph reader_order [ReaderOrderingStrategy]
        R1["Text / Docling / AnyDoc"]
        R2["LLM vision\n(use_ai + configured)"]
        R3["LiteParse + OCR strategy"]
        R4["Paddle OCR reader"]
        R5["LLM fallback\n(use_ai off, priority 95)"]
    end

    subgraph ocr_strategy [OcrRoutingStrategy — local chains only]
        ASSESS["Assess pages\n(text layer / is_complex)"]
        TEXT["TEXT route\nembedded text"]
        FAST["FAST route\nTesseract → EasyOCR"]
        DEEP["DEEP route\n+ Paddle → Surya"]
    end

    subgraph chains [Per-page HTTP callbacks]
        FASTAPI["/api/ocr/fast"]
        DEEPAPI["/api/ocr/deep"]
    end

    EX --> OCRPREP
    OCRPREP --> reader_order
    R1 --> R2
    R2 --> R3
    R3 --> R4
    R4 --> R5
    R3 --> ocr_strategy
    ASSESS --> TEXT
    ASSESS --> FAST
    ASSESS --> DEEP
    FAST --> FASTAPI
    DEEP --> DEEPAPI
```

## Reader order when `use_ai` is on

| Priority | Reader | Notes |
| --- | --- | --- |
| 5–10 | Text, Docling, AnyDoc | Native / office / structure toggles |
| **30** | **LLM** | `LLM_PRIORITY` — vision before local OCR |
| 35 | LiteParse | Layout + local OCR chains |
| 50 | OCR | Paddle PP-OCR / Structure fallback |
| 95 | LLM | `LLM_PRIORITY_FALLBACK` — inactive unless `can_process` |

## Reader order when `use_ai` is off

LLM is demoted to priority **95** (last). It stays inactive because `LLMReader.can_process` requires `use_ai`.

## Scaling

Add a new strategy by implementing the ABC and wiring it in the pipeline or LiteParse reader:

- `ReaderOrderingStrategy` — custom reader fallback order
- `OcrRoutingStrategy` — custom local OCR routing

Keep interfaces in `strategy/*/base.py`; implementations in separate modules.

## OCR callback HTTP API (`/api/ocr/fast`, `/api/ocr/deep`)

LiteParse calls these **per page image** when Tesseract is insufficient. Full reference:
[docs/ocr-callback-api.md](../../../docs/ocr-callback-api.md).

```mermaid
flowchart TB
    subgraph liteparse_attempts [LiteParse parse attempts]
        T["tesseract\n(built-in, no HTTP)"]
        F["fast attempt\nocr_server_url → /api/ocr/fast"]
        D["deep attempt\nocr_server_url → /api/ocr/deep"]
        T --> F
        F --> D
    end

    subgraph fast_ep [POST /api/ocr/fast]
        E["EasyOCR"]
    end

    subgraph deep_ep [POST /api/ocr/deep]
        P["Paddle PP-OCR"]
        S["Surya OCR"]
        P --> S
    end

    subgraph unified_ep [POST /api/ocr optional]
        U["run fast chain\n→ if weak run deep chain"]
    end

    F --> fast_ep
    D --> deep_ep
    unified_ep -.-> fast_ep
    unified_ep -.-> deep_ep
```

| Endpoint | Purpose | Backends |
| --- | --- | --- |
| `/api/ocr/fast` | Fast chain only | EasyOCR |
| `/api/ocr/deep` | Deep chain only | Paddle → Surya |
| `/api/ocr` | Auto-escalate per page | Fast then deep |

Clients use `POST /api/extract` only. These routes are internal LiteParse callbacks unless
you set `OCR_FAST_SERVER_URL` / `OCR_DEEP_SERVER_URL` to external microservices (default is local).
