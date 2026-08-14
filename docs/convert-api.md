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
| Header | `Authorization: Bearer <access_token>` |
| Token | From Google sign-in (`POST /api/auth/google`) |
| GET `/api/v1/convert` | Works without a token (guest catalog) |
| POST `/api/v1/convert` | Signed-in plan with convert permission |

Quota is shared with the workspace:

| Plan | Convert | AI or translation |
|---|---|---|
| Guest | No | No |
| Basic | 5 / day | 3 / month |
| Pro | 150 / month | 40 / month |
| Premium | 600 / month | 150 / month |

`use_ai=true` or a real `target_lang` counts as one AI/translation use.

---

## `GET /api/v1/convert`

Returns what `POST` accepts **right now**.

```bash
curl -s http://127.0.0.1:8000/api/v1/convert
curl -s -H "Authorization: Bearer TOKEN" http://127.0.0.1:8000/api/v1/convert
```

Response fields:

| Field | Meaning |
|---|---|
| `max_upload_mb` | Upload cap (default **50**) |
| `plan` | `anonymous`, `basic`, `pro`, or `premium` |
| `inputs` | Grouped source extensions |
| `input_extensions` | Flat allow-list |
| `targets` | Output formats (`available` may be false) |
| `languages` | `target_lang` ids |
| `options` | Every form field: type, default, `available`, `allowed` |
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
curl -s -H "Authorization: Bearer TOKEN" \
  -F file=@report.pdf \
  -F target=html \
  -F use_ai=false \
  -F target_lang=original \
  http://127.0.0.1:8000/api/v1/convert
```

Booleans accept `true` / `false` / `1` / `0` / `yes` / `no` / `on`.

### Form fields

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `file` | file | — | **yes** | Source document. Filename extension must be in the input list. |
| `target` | enum | `markdown` | no | Output in `content`. Aliases: `md` → markdown, `text` → txt. |
| `download` | bool | `false` | no | If `true`, response is the file (`Content-Disposition: attachment`) instead of JSON. |
| `use_ai` | bool | `false` | no | AI reading for images and scanned PDFs. Needs `capabilities.ai` and AI quota. |
| `use_doc_preprocessor` | bool | `false` | no | Orientation / unwarping cleanup. |
| `use_table_recognition` | bool | `true` | no | Recover grid / table layout. |
| `use_formula_recognition` | bool | `false` | no | Math as LaTeX. |
| `use_seal_recognition` | bool | `false` | no | Stamps and seals. |
| `use_chart_recognition` | bool | `false` | no | Charts to structured data. |
| `use_region_detection` | bool | `true` | no | Layout region analysis. |
| `format_block_content` | bool | `true` | no | Markdown / HTML block formatting. |
| `target_lang` | enum | `original` (skip) | no | Translate after reading. Needs `capabilities.translate` and AI quota. |

Pipeline: **Text** (`.txt` / `.md`) → **AnyDoc** → **LLM** (if `use_ai`) → **OCR**, then optional translation, then export to `target`.

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
| `pdf` | | `.pdf` | `application/pdf` | **no** — browser print in the app; use `html` |

`docx` / `xlsx` / `pptx` are not output formats.

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
| `markdown` | Hub format after read (+ translation) |
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
| 401 | — | Missing / expired token |
| 403 | `plan_forbidden` | Guest, or plan cannot use AI / translate (`feature`: `extract`, `extract.ai`, `extract.translate`) |
| 403 | `quota_day` / `quota_month` | Convert quota used up |
| 403 | `quota_ai_day` / `quota_ai_month` | AI / translation quota used up |
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
curl -s -H "Authorization: Bearer TOKEN" \
  -F file=@notes.txt \
  http://127.0.0.1:8000/api/v1/convert
```

HTML + translation:

```bash
curl -s -H "Authorization: Bearer TOKEN" \
  -F file=@scan.png \
  -F target=html \
  -F use_ai=true \
  -F target_lang=en \
  http://127.0.0.1:8000/api/v1/convert
```

Save the exported file:

```bash
curl -s -H "Authorization: Bearer TOKEN" \
  -F file=@deck.pptx \
  -F target=txt \
  -F download=true \
  -o deck.txt \
  http://127.0.0.1:8000/api/v1/convert
```

Python:

```python
import requests

base = "http://127.0.0.1:8000"
headers = {"Authorization": f"Bearer {token}"}

catalog = requests.get(f"{base}/api/v1/convert", headers=headers).json()
assert catalog["capabilities"]["translate"]  # if you will set target_lang

with open("report.pdf", "rb") as fh:
    res = requests.post(
        f"{base}/api/v1/convert",
        headers=headers,
        files={"file": ("report.pdf", fh, "application/pdf")},
        data={
            "target": "markdown",
            "use_ai": "false",
            "use_table_recognition": "true",
            "use_region_detection": "true",
            "format_block_content": "true",
            "target_lang": "original",
        },
    )
res.raise_for_status()
print(res.json()["markdown"])
```
