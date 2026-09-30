---
name: design-editing
description: >-
  Edit design-pad templates via DesignOp DSL, chat agent, and store executor.
  Use when working on design editor AI, chat UI, template mutations, or
  /templates vibecoding features.
---

# Design Editing

## When to use

- Adding or changing the design editor chat (`ChatPanel`, `useDesignChat`)
- Extending the DesignOp DSL or executor
- Backend design-edit prompts, schema, or `/api/templates/edit`
- Debugging undo/history behavior for batched AI edits

## Source of truth

| Concern | Location |
|---------|----------|
| Op types (TS) | `frontend/src/design-pad/ops/schema.ts` |
| Op validation | `frontend/src/design-pad/ops/validate.ts` |
| Op execution | `frontend/src/design-pad/ops/executor.ts` |
| Document store | `frontend/src/design-pad/store.ts` |
| Agent tools (LLM surface) | `backend/app/processing/template/agent_tools.py` |
| Runtime prompt | `backend/app/processing/template/prompts/design_edit_prompt.py` |
| LLM schema | `backend/app/processing/template/ops_schema.py` |
| Design Agent engine | `backend/app/engines/llm/design_agent.py` (`DESIGN_AGENT_*`) |
| API route | `POST /api/templates/edit` in `backend/app/api/template_routes.py` |
| Image packaging guard | `infra/docker/assert_runtime_assets.py` (runs in Dockerfile) |

## Packaging rule

Never store runtime prompts as `.md` under `backend/app`. Root `.dockerignore` excludes
`**/*.md`, which previously shipped a Lambda image that crashed on every request.
Keep prompts as Python modules; the Docker build fails if they are missing.

## Architecture

1. User message → `editDesign()` API → **DesignAgentEngine** (`DESIGN_AGENT_*`)
2. LLM returns `{ designBrief, reply, steps[{ reasoning, summary, tools }] }`
3. Backend expands tools → DesignOps; injects `scaffold_page` on creates if missing
4. **Simulates** on a server copy → layout QA → deterministic polish → optional repair pass
5. Frontend applies steps with shared `ai_<kind>_<n>` ids; chat shows Design plan + steps

### Agent workflow (Cursor-like)

Coding agents are better because they **plan structure before filling details**. The Design
Agent must do the same:

**Create**
1. **designBrief** — intent, concept, ordered vertical `bands`
2. **Spine** — `scaffold_page` + declare variables
3. **One step per band** — `add_section` / `add_info_row` / `add_two_col`
4. **Polish** — hierarchy/chrome; server QA fixes width/overlaps

**Adjust / update**
1. **designBrief** — intent `adjust`|`update`; bands list mutation targets
2. Resolve real ids from `nodeIndex` (`index`, `path`) / `selection`
3. `edit_node` update/remove (or `edit_variable`) in safe order — never rebuild unless asked

### Agent tools (LLM-facing)

- `scaffold_page` — root column layout (required first on creates)
- `add_section` — full-width invisible section + title
- `add_info_row` — label/value row
- `add_two_col` — two equal columns
- `edit_node` / `edit_variable` / `edit_page` / `select`

## Rules

- **Never** bypass the executor to patch document JSON from chat code (except explicit import/load flows).
- **Every** agent step must include non-empty `reasoning` in the schema and UI.
- Match existing design-pad naming (`parentId`, `sampleValue`, `kind`).
- Only `box` nodes accept children; never remove `root`.
- Prefer macros over raw freeform `edit_node` adds on root.
- Use `{{ variable }}` tokens; declare with `edit_variable` first.
- Use `last_created` / `last_created_sibling` / `last_column` aliases inside a step.
  Stack info rows with `last_column` (never `last_created_sibling` after a row).
- For existing-node edits, use real ids from `nodeIndex`/`selection` — not `last_created`.
- Design-edit uses `DESIGN_AGENT_*` (falls back to `LLM_*` when unset).
- Reuse `assert_can_use_ai` and `AI_ACTION` usage metering for the edit endpoint.

## Extending

1. Prefer extending **agent tool params** in `agent_tools.py` + prompt
2. Only add a low-level DesignOp when the executor needs a new primitive
3. Mirror TS types / validate / executor / tests

## UI

- Chat lives in bottom dock (`.design-chat-dock`) inside `.canvas-column`
- Toggle via toolbar chat icon (`IconChat`)
- Agent turns show user → Design plan (bands) → Thinking/tools → reply
- Opening a starter from `/templates` with `?starter=` must not reopen TemplatePicker
