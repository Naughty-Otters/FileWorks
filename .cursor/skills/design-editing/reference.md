# Design agent tools + DesignOp reference

The LLM sees **4 agent tools**. The backend expands them into DesignOps that the
client executor applies.

## Agent tools (LLM surface)

### Macros (prefer for creates)

- `scaffold_page` — root column auto-layout (**required first** on creates)
- `add_section` — full-width invisible section + title
- `add_info_row` — label/value row
- `add_two_col` — two equal invisible columns

### Response shape

`designBrief` `{ intent, concept, bands[], notes }` then `steps` (one band per step).

### Primitives

### `edit_node`

```json
{
  "tool": "edit_node",
  "action": "add",
  "kind": "heading",
  "parentId": "root",
  "label": "Invoice {{ invoice_number }}",
  "level": 1,
  "style": { "fontSize": 32, "align": "center", "bold": true },
  "layout": { "enabled": true, "direction": "column", "gap": 8, "padding": 24, "align": "center" },
  "box": { "x": 16, "y": 16, "w": 400, "h": 80 },
  "image": { "imageSrc": "{{ logo }}", "objectFit": "contain" },
  "repeat": { "over": "line_items", "as": "item" },
  "id": "last_created",
  "index": 0
}
```

`action`: `add` | `update` | `remove`.

**Modify recipes (use real ids from `nodeIndex` / `selection`):**

| Ask | Call |
|---|---|
| Relabel | `{ tool: "edit_node", action: "update", id, label }` |
| Style | `{ tool: "edit_node", action: "update", id, style }` |
| Layout gap/pad | `{ tool: "edit_node", action: "update", id, layout }` |
| Resize | `{ tool: "edit_node", action: "update", id, box: { w, h } }` |
| Reorder | `{ tool: "edit_node", action: "update", id, parentId, index }` |
| Delete | `{ tool: "edit_node", action: "remove", id }` |

Never use `last_created` for existing-node edits. Never remove `root`.
Deleting a box removes descendants. Prefer smallest matching node.

### `edit_variable`

```json
{
  "tool": "edit_variable",
  "action": "add",
  "name": "invoice_date",
  "label": "Invoice date",
  "type": "date",
  "sampleValue": "2026-01-15"
}
```

### `edit_page`

```json
{ "tool": "edit_page", "width": 794, "pageCount": 2 }
```

### `select`

```json
{ "tool": "select", "id": "heading_abc" }
```

## Aliases

- `id` / `parentId`: `last_created` — node from the latest add in this step
- `parentId`: `last_created_sibling` — parent of last created (sibling placement)
- `parentId`: `last_column` — nearest column-layout ancestor (section). **Required**
  when stacking `add_info_row` — never use `last_created_sibling` after a row
  (that nests row-in-row and collapses widths to ~20px)

## Document context (modify targeting)

- `nodeIndex[].index` — 0-based sibling index under `parentId` (reorder)
- `nodeIndex[].path` — `root > … > id` (disambiguate labels)
- `selection` — default target for this/that/selected
- `layoutMap` — sibling frames + overlap warnings; `layoutMode` column|row|freeform

## Layout / pile-ups

- Document context includes `layoutMap` (sibling boxes + overlap warnings) and `layoutMode`.
- Prefer `layout: { enabled: true, direction: "column", … }` on section boxes; nest children with `parentId: "last_created"`.
- Omit `box.x` / `box.y` unless intentional freeform. Executor stacks omitted coords via `nextStackedPosition`.
- Root is often freeform — do not dump many leaves directly on root.

## Completeness checklist

Creates/updates should consider: **structure → layout → components → labels → variables → style**.
Never leave an empty decorative box unless the user asked for a spacer.

## Low-level DesignOps (executor only)

Applied by the client after expansion. Do not expose these in the LLM schema.

`select`, `add_element`, `remove_element`, `update_label`, `update_style`, `update_level`,
`move_node`, `resize_node`, `update_box`, `update_layout_props`, `toggle_auto_layout`,
`move_in_tree`, `update_image`, `update_node`, `add_variable`, `update_variable`,
`remove_variable`, `set_page_width`, `set_page_count`.

## Example response shape

```json
{
  "reply": "Added a header band with a title bound to document_title.",
  "steps": [
    {
      "reasoning": "A column auto-layout header keeps the title centered; declare the variable before the token.",
      "summary": "Add header with title variable",
      "tools": [
        {
          "tool": "edit_variable",
          "action": "add",
          "name": "document_title",
          "label": "Title",
          "type": "text",
          "sampleValue": "Invoice"
        },
        {
          "tool": "edit_node",
          "action": "add",
          "kind": "box",
          "parentId": "root",
          "layout": { "enabled": true, "direction": "column", "gap": 8, "padding": 24, "align": "center" }
        },
        {
          "tool": "edit_node",
          "action": "add",
          "kind": "heading",
          "parentId": "last_created",
          "label": "{{ document_title }}",
          "level": 1,
          "style": { "fontSize": 32, "align": "center", "bold": true }
        }
      ]
    }
  ]
}
```
