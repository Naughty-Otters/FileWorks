"use client";

import { useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { extractUsedVariableNames } from "../templating";
import { typeDefaultValue } from "../defaults";
import { readAndDownscaleImage } from "../imageUtils";
import {
  isValidVariableName,
  nextId,
  VARIABLE_TYPE_OPTIONS,
  type TemplateVariable,
  type VariableSchemaField,
  type VariableType,
} from "../types";
import { IconPlus, IconTrash } from "../icons";

const RICH_TYPES: VariableType[] = ["list", "object", "image"];
const SIMPLE_TYPE_OPTIONS = VARIABLE_TYPE_OPTIONS.filter((o) => !RICH_TYPES.includes(o.value));

const TYPE_HINT: Partial<Record<VariableType, string>> = {
  text: "Plain text",
  number: "Numeric",
  currency: "Money",
  date: "Date string",
};

export default function VariablesPanel() {
  const doc = useEditorStore((s) => s.doc);
  const addVariable = useEditorStore((s) => s.addVariable);
  const updateVariable = useEditorStore((s) => s.updateVariable);
  const removeVariable = useEditorStore((s) => s.removeVariable);
  const close = () => useEditorStore.getState().setShowVariablesPanel(false);

  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<VariableType>("text");
  const [error, setError] = useState<string | null>(null);

  const declaredNames = useMemo(() => new Set(doc.variables.map((v) => v.name)), [doc.variables]);
  const undeclared = useMemo(() => {
    const used = extractUsedVariableNames(doc.root);
    return [...used].filter((n) => !declaredNames.has(n));
  }, [doc.root, declaredNames]);

  function declare(name: string, label?: string, type: VariableType = "text") {
    const trimmed = name.trim();
    if (!isValidVariableName(trimmed)) {
      setError("Use letters, numbers, and underscores — dots for grouping (e.g. employee.name).");
      return;
    }
    if (declaredNames.has(trimmed)) {
      setError(`"${trimmed}" is already declared.`);
      return;
    }
    addVariable(trimmed, label?.trim() || trimmed, type, typeDefaultValue(type));
    const created = useEditorStore.getState().doc.variables.find((v) => v.name === trimmed);
    if (created && type === "list") {
      updateVariable(created.id, {
        itemSchema: defaultListSchema(),
        sampleValue: JSON.stringify([
          { description: "Design services", amount: "$900" },
          { description: "Hosting", amount: "$100" },
        ]),
      });
    } else if (created && type === "object") {
      updateVariable(created.id, {
        sampleValue: JSON.stringify({ name: "Acme Co.", address: "100 Main Street" }),
      });
    }
    setNewName("");
    setNewLabel("");
    setError(null);
  }

  function quickAdd(type: VariableType) {
    const base = type === "list" ? "items" : type === "object" ? "customer" : type === "image" ? "logo" : "field";
    let name = base;
    let n = 2;
    while (declaredNames.has(name)) {
      name = `${base}_${n}`;
      n += 1;
    }
    const label =
      type === "list" ? "Line items" : type === "object" ? "Customer" : type === "image" ? "Logo" : "Field";
    declare(name, label, type);
  }

  return (
    <div className="template-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="template-modal variables-modal">
        <button type="button" className="template-close" title="Close" onClick={close}>
          ×
        </button>
        <h2>Placeholders</h2>
        <p>
          Bind page content with <code className="var-token">{"{{ name }}"}</code>. Use the cards
          below for <strong>List</strong>, <strong>Object</strong>, and <strong>Image</strong> —
          they open a structured default editor. Simple types (text, number, …) use the form at the
          bottom.
        </p>

        <div className="var-type-launch">
          <button type="button" className="var-type-card" onClick={() => quickAdd("list")}>
            <span className="var-type-card-title">List</span>
            <span className="var-type-card-desc">Rows for Repeat boxes (line items, transactions)</span>
          </button>
          <button type="button" className="var-type-card" onClick={() => quickAdd("object")}>
            <span className="var-type-card-title">Object</span>
            <span className="var-type-card-desc">Grouped keys like customer.name / address</span>
          </button>
          <button type="button" className="var-type-card" onClick={() => quickAdd("image")}>
            <span className="var-type-card-title">Image</span>
            <span className="var-type-card-desc">Default logo or photo for image blocks</span>
          </button>
        </div>

        {undeclared.length > 0 && (
          <div className="var-undeclared">
            <h4>Used on the page but not declared yet</h4>
            {undeclared.map((name) => (
              <div key={name} className="var-undeclared-row">
                <span className="var-token">{name}</span>
                <button type="button" className="chip-btn" onClick={() => declare(name)}>
                  Declare
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="var-list">
          {doc.variables.length === 0 && (
            <p className="inspector-hint">No variables yet — use the cards above, or add one below.</p>
          )}
          {doc.variables.map((v) => (
            <VariableCard
              key={v.id}
              variable={v}
              onUpdate={(patch) => updateVariable(v.id, patch)}
              onRemove={() => removeVariable(v.id)}
            />
          ))}
        </div>

        <div className="var-add-row">
          <input
            placeholder="name (e.g. customer)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <select value={newType} onChange={(e) => setNewType(e.target.value as VariableType)}>
            {SIMPLE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn var-add-btn"
            title="Add variable"
            onClick={() => declare(newName, newLabel, newType)}
          >
            <IconPlus />
          </button>
        </div>
        {error && <div className="json-error">{error}</div>}
      </div>
    </div>
  );
}

function VariableCard({
  variable: v,
  onUpdate,
  onRemove,
}: {
  variable: TemplateVariable;
  onUpdate: (patch: Partial<TemplateVariable>) => void;
  onRemove: () => void;
}) {
  const isRich = RICH_TYPES.includes(v.type);

  return (
    <div className={`var-card type-${v.type}${isRich ? " rich" : ""}`}>
      <div className="var-card-top">
        <div className="var-card-identity">
          <span className="var-token">{v.name}</span>
          <input
            className="var-row-label"
            placeholder="Label"
            value={v.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
          />
        </div>
        <button type="button" className="icon-btn" title="Delete variable" onClick={onRemove}>
          <IconTrash />
        </button>
      </div>

      {isRich ? (
        <div className="var-rich-type-row">
          <span className="var-rich-badge">{v.type === "list" ? "List" : v.type === "object" ? "Object" : "Image"}</span>
          <span className="var-rich-type-hint">Added via the cards above — structured editor only</span>
        </div>
      ) : (
        <div className="var-type-chips" role="group" aria-label="Variable type">
          {SIMPLE_TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`var-type-chip${v.type === o.value ? " active" : ""}`}
              title={TYPE_HINT[o.value]}
              onClick={() => {
                const type = o.value;
                const keep = v.sampleValue?.trim();
                onUpdate({
                  type,
                  sampleValue: keep || typeDefaultValue(type),
                  itemSchema: undefined,
                });
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="var-default-label">
        Default value
        {isRich ? <span className="var-rich-badge">Structured editor</span> : null}
      </div>

      {v.type === "list" ? (
        <ListDefaultEditor variable={v} onUpdate={onUpdate} />
      ) : v.type === "object" ? (
        <ObjectDefaultEditor variable={v} onUpdate={onUpdate} />
      ) : v.type === "image" ? (
        <ImageDefaultEditor variable={v} onUpdate={onUpdate} />
      ) : (
        <input
          className="var-row-sample full"
          placeholder={placeholderFor(v.type)}
          value={v.sampleValue}
          onChange={(e) => onUpdate({ sampleValue: e.target.value })}
        />
      )}
    </div>
  );
}

function defaultListSchema(): VariableSchemaField[] {
  return [
    { id: nextId("field"), name: "description", label: "Description", type: "text" },
    { id: nextId("field"), name: "amount", label: "Amount", type: "currency" },
  ];
}

function placeholderFor(type: VariableType): string {
  switch (type) {
    case "currency":
      return "$0.00";
    case "number":
      return "0";
    case "date":
      return "August 20, 2026";
    default:
      return "Default when unset";
  }
}

function ListDefaultEditor({
  variable,
  onUpdate,
}: {
  variable: TemplateVariable;
  onUpdate: (patch: Partial<TemplateVariable>) => void;
}) {
  const fields = variable.itemSchema?.length
    ? variable.itemSchema
    : [{ id: "auto", name: "value", label: "Value", type: "text" as const }];

  let rows: Record<string, string>[] = [];
  try {
    const parsed = JSON.parse(variable.sampleValue || "[]");
    rows = Array.isArray(parsed)
      ? parsed.map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            return Object.fromEntries(
              fields.map((f) => [f.name, String((item as Record<string, unknown>)[f.name] ?? "")]),
            );
          }
          return { [fields[0].name]: String(item ?? "") };
        })
      : [];
  } catch {
    rows = [];
  }

  function commit(next: Record<string, string>[]) {
    onUpdate({ sampleValue: JSON.stringify(next) });
  }

  return (
    <div className="var-structured">
      <div className="var-structured-hint">Each row is one list item for box Repeat (e.g. items → item).</div>
      {rows.length === 0 ? (
        <p className="inspector-hint">No rows yet — add a sample line item for preview.</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="var-list-row">
          <span className="var-list-index">#{index + 1}</span>
          <div className="var-list-fields">
            {fields.map((field) => (
              <label key={field.id} className="var-mini-field">
                <span>{field.label || field.name}</span>
                <input
                  value={row[field.name] ?? ""}
                  onChange={(e) => {
                    const next = rows.map((r, i) =>
                      i === index ? { ...r, [field.name]: e.target.value } : r,
                    );
                    commit(next);
                  }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="icon-btn"
            title="Remove row"
            onClick={() => commit(rows.filter((_, i) => i !== index))}
          >
            <IconTrash />
          </button>
        </div>
      ))}
      <div className="var-structured-actions">
        <button
          type="button"
          className="chip-btn primary"
          onClick={() =>
            commit([
              ...rows,
              Object.fromEntries(
                fields.map((f) => [f.name, f.type === "currency" ? "$0.00" : f.name === "description" ? "Service" : ""]),
              ),
            ])
          }
        >
          + Add row
        </button>
      </div>
      <SchemaEditor
        fields={variable.itemSchema || []}
        onChange={(itemSchema) => {
          onUpdate({
            itemSchema,
            sampleValue:
              itemSchema.length && (!variable.itemSchema || variable.itemSchema.length === 0)
                ? variable.sampleValue
                : variable.sampleValue,
          });
        }}
      />
    </div>
  );
}

function ObjectDefaultEditor({
  variable,
  onUpdate,
}: {
  variable: TemplateVariable;
  onUpdate: (patch: Partial<TemplateVariable>) => void;
}) {
  let entries: [string, string][] = [];
  try {
    const parsed = JSON.parse(variable.sampleValue || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      entries = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]);
    }
  } catch {
    entries = [];
  }

  function commit(next: [string, string][]) {
    const obj = Object.fromEntries(next.filter(([k]) => k.trim()));
    onUpdate({ sampleValue: JSON.stringify(obj) });
  }

  return (
    <div className="var-structured">
      <div className="var-structured-hint">
        Key / value pairs for tokens like <code>{"{{ customer.name }}"}</code>.
      </div>
      {entries.length === 0 ? (
        <p className="inspector-hint">No fields yet — add name, address, etc.</p>
      ) : null}
      {entries.map(([key, value], index) => (
        <div key={index} className="var-object-row">
          <input
            placeholder="key"
            value={key}
            onChange={(e) => {
              const next = entries.map((pair, i) => (i === index ? [e.target.value, pair[1]] : pair)) as [
                string,
                string,
              ][];
              commit(next);
            }}
          />
          <input
            placeholder="value"
            value={value}
            onChange={(e) => {
              const next = entries.map((pair, i) => (i === index ? [pair[0], e.target.value] : pair)) as [
                string,
                string,
              ][];
              commit(next);
            }}
          />
          <button
            type="button"
            className="icon-btn"
            title="Remove field"
            onClick={() => commit(entries.filter((_, i) => i !== index))}
          >
            <IconTrash />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="chip-btn primary"
        onClick={() => commit([...entries, entries.length === 0 ? ["name", "Acme Co."] : ["field", ""]])}
      >
        + Add field
      </button>
    </div>
  );
}

function ImageDefaultEditor({
  variable,
  onUpdate,
}: {
  variable: TemplateVariable;
  onUpdate: (patch: Partial<TemplateVariable>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const src = variable.sampleValue;

  return (
    <div className="var-image-default">
      <div
        className={`var-image-drop${src ? " has-image" : ""}`}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Default" />
        ) : (
          <span>Drop or click to set a default image</span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const dataUrl = await readAndDownscaleImage(file);
          onUpdate({ sampleValue: dataUrl });
          e.target.value = "";
        }}
      />
      <div className="var-structured-actions">
        <button type="button" className="chip-btn primary" onClick={() => fileRef.current?.click()}>
          {src ? "Replace image" : "Choose image"}
        </button>
        {src ? (
          <button type="button" className="chip-btn" onClick={() => onUpdate({ sampleValue: "" })}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SchemaEditor({
  fields,
  onChange,
}: {
  fields: VariableSchemaField[];
  onChange: (fields: VariableSchemaField[]) => void;
}) {
  return (
    <div className="var-schema">
      <div className="var-schema-head">
        <span>Item fields (schema)</span>
        <button
          type="button"
          className="icon-btn"
          title="Add field"
          onClick={() =>
            onChange([...fields, { id: nextId("field"), name: "field", label: "Field", type: "text" }])
          }
        >
          <IconPlus />
        </button>
      </div>
      {fields.map((field) => (
        <div key={field.id} className="var-schema-row">
          <input
            value={field.name}
            onChange={(e) =>
              onChange(
                fields.map((item) =>
                  item.id === field.id ? { ...item, name: e.target.value, label: e.target.value } : item,
                ),
              )
            }
          />
          <select
            value={field.type}
            onChange={(e) =>
              onChange(
                fields.map((item) =>
                  item.id === field.id
                    ? { ...item, type: e.target.value as VariableSchemaField["type"] }
                    : item,
                ),
              )
            }
          >
            {VARIABLE_TYPE_OPTIONS.filter((o) => o.value !== "list").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn"
            title="Remove field"
            onClick={() => onChange(fields.filter((item) => item.id !== field.id))}
          >
            <IconTrash />
          </button>
        </div>
      ))}
    </div>
  );
}
