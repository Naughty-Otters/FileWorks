# FileWorks Convert API

One-shot conversion: upload a file, get Markdown (and an exported format) in the same response.

This is **not** the workspace UI flow. The app still uses `POST /api/extract` (optional `s3_key`) and `POST /api/export`. Do not send `s3_key` here.

Interactive OpenAPI: http://127.0.0.1:8000/docs

Live option check (inputs, targets, defaults, and whether AI / translation are on):

```http
GET /api/v1/convert
```

Always call GET first. `available` / `allowed` on each option reflect this server and the caller’s plan.

---

## Auth and quota

| | |
|---|---|
| Header | `Authorization: Bearer fw_live_…` (recommended). Also accepted: raw `Authorization: fw_live_…` or `X-Api-Key: fw_live_…`. |
| Key | Create on Profile. Prefix `fw_live_`. Does not expire until you revoke it. Workspace Google tokens are rejected. |
| GET `/api/v1/convert` | Works without a key (guest catalog) |
| POST `/api/v1/convert` | API key required. Workspace Google access tokens are rejected. |

Convert API is a **separate product** from the workspace (Casual / Daily / Expert). Keys bill AI page credits on the API plan. Standard convert is free up to a monthly page cap. Workspace file quotas do not apply.

Quota numbers (AI credits, standard pages, key limits) are defined in `frontend/src/lib/plan-quotas.ts` (`API_QUOTAS`) and enforced in `backend/app/auth/api_plans.py`. Change both when adjusting allowances.

Credits: **0 per page** for a standard convert. **1 per page** when `use_ai=true`, a real `target_lang` is set, or Design `design_fill=auto`. Unused credits do not roll over. An API plan can be combined with any workspace role.

---

## `GET /api/v1/convert`

Returns what `POST` accepts **right now**.

```bash
curl -s http://127.0.0.1:8000/api/v1/convert
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" http://127.0.0.1:8000/api/v1/convert
```

Response fields:

| Field | Meaning |
|---|---|
| `max_upload_mb` | Upload cap (default **50**) |
| `plan` | Workspace role: `anonymous`, `basic`, `pro`, or `premium` |
| `api_plan` | API product: `api_free`, `api_builder`, `api_scale`, or `api_business` |
| `credits` | Page-credit prices and remaining API allowance |
| `inputs` | Grouped source extensions |
| `input_extensions` | Flat allow-list |
| `targets` | Output formats (`available` may be false) |
| `languages` | `target_lang` ids |
| `options` | Every form field: type, default, `available`, `allowed` |
| `pipeline` | Deploy-time stages, readers, and OCR backends (`enabled` + per-engine `config`) |
| `capabilities.ai` | Server can do AI reading |
| `capabilities.translate` | Server can translate |

On each option:

- `available` — this deployment can do it (LLM / translator configured)
- `allowed` — this plan may use it
- `unavailable_reason` — why `available` is false

---

## `POST /api/v1/convert`

`multipart/form-data`. Send the file bytes as `file`. There is no `s3_key`.

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@report.pdf \
  -F target=html \
  -F use_ai=false \
  -F target_lang=original \
  http://127.0.0.1:8000/api/v1/convert
```

Print Markdown from that JSON (needs [jq](https://jqlang.github.io/jq/)):

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@report.pdf \
  -F target=markdown \
  http://127.0.0.1:8000/api/v1/convert \
  | jq -r .markdown
```

Save as Word:

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@report.pdf \
  -F target=docx \
  -F download=true \
  -o report.docx \
  http://127.0.0.1:8000/api/v1/convert
```

Save Markdown with no JSON wrapper:

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@report.pdf \
  -F target=markdown \
  -F download=true \
  -o report.md \
  http://127.0.0.1:8000/api/v1/convert
```

Booleans accept `true` / `false` / `1` / `0` / `yes` / `no` / `on`.

### Form fields

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `file` | file | — | **yes** | Source document. Filename extension must be in the input list. |
| `target` | enum | `markdown` | no | Output in `content`. Aliases: `md` → markdown, `text` → txt, `word` → docx. DOCX is base64 in JSON unless `download=true`. |
| `download` | bool | `false` | no | If `true`, response is the file (`Content-Disposition: attachment`) instead of JSON. |
| `use_ai` | bool | `false` | no | AI reading for images and scanned PDFs. Needs `capabilities.ai` and AI quota. |
| `prefer_structure` | bool | `false` | no | PDF/scans try layout reading first; AnyDoc remains the fallback. Office still uses AnyDoc. |
| `preserve_images` | bool | `true` | no | Keep original charts and figures next to extracted text on each page. |
| `use_doc_preprocessor` | bool | `false` | no | Orientation / unwarping cleanup. |
| `use_table_recognition` | bool | `true` | no | Recover grid / table layout. |
| `use_formula_recognition` | bool | `false` | no | Math as LaTeX. |
| `use_seal_recognition` | bool | `false` | no | Stamps and seals. |
| `use_chart_recognition` | bool | `false` | no | Charts to structured data. |
| `use_region_detection` | bool | `true` | no | Layout region analysis. |
| `format_block_content` | bool | `true` | no | Markdown / HTML block formatting. |
| `target_lang` | enum | `original` (skip) | no | Translate after reading. Needs `capabilities.translate` and AI quota. |

Pipeline: **Text** (`.txt` / `.md`) → **Docling** (PDF/images when `prefer_structure`) → **AnyDoc** → **LLM** (if `use_ai`) → **OCR**, then optional structure edit / translation, then export to `target`.

---

## Inputs

Max size: `max_upload_mb` from GET (default 50 MB). Empty files are rejected.

| Group | Extensions |
|---|---|
| Images | `.png` `.jpg` `.jpeg` `.bmp` `.tif` `.tiff` `.webp` |
| PDF | `.pdf` |
| Word | `.doc` `.docx` `.docm` |
| PowerPoint | `.ppt` `.pps` `.pot` `.pptx` `.pptm` `.ppsx` `.ppsm` |
| Excel | `.xls` `.xlsx` `.xlsm` `.xlsb` |
| OpenDocument | `.odt` `.ods` `.odp` |
| Rich text | `.rtf` |
| Ebook | `.epub` |
| Text / Markdown | `.txt` `.md` `.markdown` `.csv` |

---

## Targets

| `target` | Aliases | File | Media type | Available |
|---|---|---|---|---|
| `markdown` | `md` | `.md` | `text/markdown; charset=utf-8` | yes |
| `txt` | `text` | `.txt` | `text/plain; charset=utf-8` | yes |
| `html` | | `.html` | `text/html; charset=utf-8` | yes |
| `json` | | `.json` | `application/json; charset=utf-8` | yes |
| `docx` | `word` | `.docx` | Word OOXML | yes |
| `pdf` | | `.pdf` | `application/pdf` | **no** — browser print in the app; use `html` |

`xlsx`, `pptx`, PNG, and JPEG are not output formats. For DOCX, prefer `download=true`; JSON puts the bytes in `content` as base64 (`content_encoding=base64`).

---

## Languages (`target_lang`)

Skip translation with `original`, `none`, `off`, `source`, `keep`, or empty.

| id | Language |
|---|---|
| `original` | No translation |
| `en` | English |
| `zh` | Chinese (Simplified) |
| `zh-TW` | Chinese (Traditional) |
| `ja` | Japanese |
| `ko` | Korean |
| `fr` | French |
| `de` | German |
| `es` | Spanish |
| `pt` | Portuguese |
| `it` | Italian |
| `ru` | Russian |
| `ar` | Arabic |
| `hi` | Hindi |
| `vi` | Vietnamese |
| `th` | Thai |
| `id` | Indonesian |
| `nl` | Dutch |
| `pl` | Polish |
| `tr` | Turkish |

---

## JSON response

Default (`download=false`):

```json
{
  "id": "a1b2c3…",
  "source": {
    "filename": "report.pdf",
    "extension": ".pdf",
    "content_type": "application/pdf",
    "size_bytes": 184320
  },
  "target": "html",
  "filename": "report.html",
  "media_type": "text/html; charset=utf-8",
  "markdown": "# Report\n\n…",
  "content": "<!DOCTYPE html>…",
  "options": {
    "use_ai": false,
    "use_doc_preprocessor": false,
    "use_seal_recognition": false,
    "use_table_recognition": true,
    "use_formula_recognition": false,
    "use_chart_recognition": false,
    "use_region_detection": true,
    "format_block_content": true,
    "target_lang": ""
  },
  "engine": "FileWorks",
  "page_count": 3
}
```

| Field | Meaning |
|---|---|
| `markdown` | Hub format after read (+ translation). Multi-page files join pages with `---` |
| `page_count` | Number of source pages actually converted (`len(pages)`) |
| `credits_used` | API credits billed for this request |
| `content` | Exported `target` (UTF-8 text) |
| `filename` / `media_type` | Suggested download name and type |
| `options` | Values that were applied |
| `engine` | Always `FileWorks` in the public API |

`download=true` returns the file bytes with `Content-Disposition: attachment`.

---

## Errors

| HTTP | `detail.code` | When |
|---|---|---|
| 400 | `unsupported_input` | Extension not in the input list (`available` = extensions) |
| 400 | `unsupported_target` | Unknown or unavailable `target` (`available` = ids) |
| 400 | `unsupported_language` | Unknown `target_lang` (`available` = language ids) |
| 400 | `option_unavailable` | `use_ai` or `target_lang` requested but the server cannot do it |
| 400 | — | Empty file |
| 401 | `api_key_required` | Missing API key (workspace JWT is not enough) |
| 401 | — | Invalid or revoked API key |
| 403 | `quota_credits` | API credit allowance used up |
| 413 | — | Over `max_upload_mb` |
| 422 | — | Missing `file` (including a body that only has `s3_key`) |
| 500 | — | Conversion failed |
| 503 | — | AI / translation on this deploy needs S3 |

Example:

```json
{
  "detail": {
    "code": "unsupported_target",
    "field": "target",
    "message": "Unsupported target 'docx'.",
    "available": ["markdown", "txt", "html", "json"]
  }
}
```

---

## Examples

Markdown, defaults:

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@notes.txt \
  http://127.0.0.1:8000/api/v1/convert \
  | jq -r .markdown
```

HTML + translation:

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@scan.png \
  -F target=html \
  -F use_ai=true \
  -F target_lang=en \
  http://127.0.0.1:8000/api/v1/convert
```

Save the exported file:

```bash
curl -s -H "Authorization: Bearer fw_live_YOUR_API_KEY" \
  -F file=@deck.pptx \
  -F target=txt \
  -F download=true \
  -o deck.txt \
  http://127.0.0.1:8000/api/v1/convert
```

Python:

```python
import requests
from pathlib import Path

base = "http://127.0.0.1:8000"
headers = {"Authorization": f"Bearer {api_key}"}

catalog = requests.get(f"{base}/api/v1/convert", headers=headers).json()
assert catalog["capabilities"]["translate"]  # if you will set target_lang

with open("report.pdf", "rb") as fh:
    res = requests.post(
        f"{base}/api/v1/convert",
        headers=headers,
        files={"file": ("report.pdf", fh, "application/pdf")},
        data={"target": "markdown", "use_ai": "false", "target_lang": "original"},
    )
res.raise_for_status()
markdown = res.json()["markdown"]
Path("report.md").write_text(markdown, encoding="utf-8")
print(markdown)
```
