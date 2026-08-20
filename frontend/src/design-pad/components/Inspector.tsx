"use client";
import { useRef } from "react";
import { useEditorStore, findNode, findParent } from "../store";
import {
  isContainer,
  isTextKind,
  type Align,
  type BorderStyle,
  type DesignNode,
  type Direction,
  type Justify,
  type RepeatDefinition,
  type TemplateVariable,
  type TextAlign,
} from "../types";
import { readAndDownscaleImage } from "../imageUtils";
import { isPureVariableToken } from "../templating";
import TokenizedContentField from "./TokenizedContentField";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconBorderNone,
  IconBorderSolid,
  IconBorderDashed,
  IconStackRow,
  IconStackColumn,
} from "../icons";

const FONT_OPTIONS = [
  "Arial, Helvetica, sans-serif",
  "Georgia, serif",
  "'Times New Roman', Times, serif",
  "'Courier New', Courier, monospace",
  "Verdana, Geneva, sans-serif",
  "'Trebuchet MS', sans-serif",
];

/** Ancestor chain from the page down to `node`, clickable so you can jump
 * straight to a parent instead of hunting for it on a crowded canvas. */
function Breadcrumb({ node, root }: { node: DesignNode; root: DesignNode }) {
  const select = useEditorStore((s) => s.select);
  const chain: DesignNode[] = [];
  let current: DesignNode | null = node;
  while (current) {
    chain.unshift(current);
    current = current.id === "root" ? null : findParent(root, current.id);
  }
  return (
    <div className="breadcrumb">
      {chain.map((n, i) => (
        <span key={n.id}>
          {i > 0 && <span className="crumb-sep">/</span>}
          <button
            className="crumb"
            disabled={n.id === node.id}
            onClick={() => select(n.id === "root" ? null : n.id)}
          >
            {n.id === "root"
              ? "Page"
              : isTextKind(n.kind)
                ? n.kind
                : n.label || n.kind}
          </button>
        </span>
      ))}
    </div>
  );
}

/** A row of icon buttons where exactly one is active — used everywhere a
 * visual choice (alignment, border style, stacking direction) is easier
 * to recognize as a picture than to read as a word in a dropdown. */
function IconToggleGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; icon: React.ComponentType; title: string }[];
}) {
  return (
    <div className="toggle-row">
      {options.map(({ value: v, icon: Icon, title }) => (
        <button
          key={v}
          className={`icon-btn${value === v ? " active" : ""}`}
          title={title}
          onClick={() => onChange(v)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

export default function Inspector() {
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const updateLabel = useEditorStore((s) => s.updateLabel);
  const updateLevel = useEditorStore((s) => s.updateLevel);
  const resizeNode = useEditorStore((s) => s.resizeNode);
  const moveNode = useEditorStore((s) => s.moveNode);
  const updateStyle = useEditorStore((s) => s.updateStyle);
  const updateLayoutProps = useEditorStore((s) => s.updateLayoutProps);
  const toggleAutoLayout = useEditorStore((s) => s.toggleAutoLayout);
  const reorderChild = useEditorStore((s) => s.reorderChild);
  const setPageCount = useEditorStore((s) => s.setPageCount);
  const setPageWidth = useEditorStore((s) => s.setPageWidth);
  const updateImage = useEditorStore((s) => s.updateImage);
  const updateNode = useEditorStore((s) => s.updateNode);
  const previewMode = useEditorStore((s) => s.previewMode);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  if (!selectedId) {
    const page = doc.root;
    const pageCount = Math.max(1, Math.round(page.h / doc.pageSize.h));
    return (
      <div className="inspector">
        <h3 className="kind-title">Page</h3>
        <div className="field">
          <label>Page background</label>
          <input
            type="color"
            value={page.style.backgroundColor}
            onChange={(e) => updateStyle(page.id, { backgroundColor: e.target.value })}
          />
        </div>
        <p className="inspector-hint">Select a block on the page to edit it.</p>
        <details className="advanced-section">
          <summary>Page setup</summary>
          <div className="field">
            <label>Width</label>
            <input
              type="number"
              value={Math.round(doc.pageSize.w)}
              onChange={(e) => setPageWidth(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Pages</label>
            <div className="stepper-row">
              <button
                className="chip-btn"
                disabled={pageCount <= 1}
                onClick={() => setPageCount(pageCount - 1)}
              >
                −
              </button>
              <span className="stepper-value">{pageCount}</span>
              <button className="chip-btn" onClick={() => setPageCount(pageCount + 1)}>
                +
              </button>
            </div>
          </div>
        </details>
      </div>
    );
  }

  const node = findNode(doc.root, selectedId);
  if (!node) return <div className="inspector" />;
  const parent = findParent(doc.root, selectedId);
  const freeform = !parent || parent.layout === null;
  const container = isContainer(node.kind);
  const textKind = isTextKind(node.kind);
  const isImage = node.kind === "image";
  const imageIsVariable = isImage ? isPureVariableToken(node.imageSrc ?? "") : null;
  const imageVariables = doc.variables.filter((v) => v.type === "image");
  // When a box auto-arranges its contents with justify "start", its
  // stacking-axis size (height for a column, width for a row) is computed
  // from its children — it isn't something you drag or type a number
  // for, so show it as "auto" instead of a field that silently reverts on
  // the next edit. Any other justify (center/end/space-between) means the
  // box is meant to be *larger* than its content with justify
  // distributing the leftover space, so that axis stays manually
  // resizable — mirrors the same rule in the Rust engine's
  // resolve_auto_size.
  const autoAxis =
    container && node.layout && node.layout.justify === "start"
      ? node.layout.direction === "column"
        ? "h"
        : "w"
      : null;

  return (
    <div className="inspector">
      <Breadcrumb node={node} root={doc.root} />
      <h3 className="kind-title">{node.kind}</h3>

      {!isImage && (
        <div className="field">
          <label>{container ? "Caption" : "Content"}</label>
          <TokenizedContentField
            value={node.label}
            onChange={(value) => updateLabel(node.id, value)}
            multiline={node.kind === "paragraph"}
            previewMode={previewMode}
            variables={doc.variables}
          />
          <label className="field-sublabel">Insert a data field into the text</label>
          <select
            className="insert-var-select"
            value=""
            disabled={doc.variables.length === 0}
            title={
              doc.variables.length === 0
                ? "Open Variables and declare a field first"
                : "Insert {{ field }} at the end of the content"
            }
            onChange={(e) => {
              if (!e.target.value) return;
              const needsSpace = node.label.length > 0 && !/\s$/.test(node.label);
              updateLabel(node.id, `${node.label}${needsSpace ? " " : ""}{{ ${e.target.value} }}`);
            }}
          >
            <option value="">
              {doc.variables.length === 0
                ? "No data fields yet — open Variables"
                : "Insert {{ field }}…"}
            </option>
            {doc.variables.map((v) => (
              <option key={v.id} value={v.name}>
                {v.label} — {v.type} ({`{{ ${v.name} }}`})
              </option>
            ))}
          </select>
          <p className="inspector-hint">
            Places a placeholder like {"{{ customer }}"} in the content. FileWorks fills it when
            generating output (or uses the field’s default in preview).
          </p>
        </div>
      )}

      {isImage && (
        <>
          <h3>Image</h3>
          <div className="field">
            <label>Source</label>
            <div className="toggle-row">
              <button
                className={`chip-btn${!imageIsVariable ? " active" : ""}`}
                onClick={() => {
                  if (imageIsVariable) updateImage(node.id, { imageSrc: "" });
                }}
              >
                Upload
              </button>
              <button
                className={`chip-btn${imageIsVariable ? " active" : ""}`}
                disabled={!imageIsVariable && imageVariables.length === 0}
                title={
                  imageVariables.length === 0
                    ? "Declare an image-type variable in the Variables panel first"
                    : undefined
                }
                onClick={() => {
                  if (imageIsVariable || imageVariables.length === 0) return;
                  updateImage(node.id, { imageSrc: `{{${imageVariables[0].name}}}` });
                }}
              >
                Variable
              </button>
            </div>
          </div>

          {imageIsVariable ? (
            <div className="field">
              <label>Variable</label>
              <select
                value={imageIsVariable}
                onChange={(e) => updateImage(node.id, { imageSrc: `{{${e.target.value}}}` })}
              >
                {imageVariables.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.label} ({v.name})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field">
              <button
                className="chip-btn wide"
                onClick={() => imageFileInputRef.current?.click()}
              >
                {node.imageSrc ? "Replace image…" : "Choose image…"}
              </button>
              <input
                ref={imageFileInputRef}
                type="file"
                accept="image/*"
                className="image-file-input"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const dataUrl = await readAndDownscaleImage(file);
                  updateImage(node.id, { imageSrc: dataUrl });
                }}
              />
            </div>
          )}

          <div className="field">
            <label>Fit</label>
            <div className="toggle-row">
              <button
                className={`chip-btn${(node.objectFit ?? "cover") === "cover" ? " active" : ""}`}
                onClick={() => updateImage(node.id, { objectFit: "cover" })}
              >
                Fill (crop)
              </button>
              <button
                className={`chip-btn${node.objectFit === "contain" ? " active" : ""}`}
                onClick={() => updateImage(node.id, { objectFit: "contain" })}
              >
                Fit (no crop)
              </button>
            </div>
          </div>
        </>
      )}

      {node.kind === "heading" && (
        <div className="field">
          <label>Level</label>
          <div className="level-row">
            {[1, 2, 3, 4, 5, 6].map((lvl) => (
              <button
                key={lvl}
                className={`level-btn${(node.level ?? 1) === lvl ? " active" : ""}`}
                onClick={() => updateLevel(node.id, lvl)}
              >
                H{lvl}
              </button>
            ))}
          </div>
        </div>
      )}

      {textKind && (
        <>
          <h3>Typography</h3>
          <div className="field">
            <label>Font</label>
            <select
              value={node.style.fontFamily}
              onChange={(e) => updateStyle(node.id, { fontFamily: e.target.value })}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f.split(",")[0].replace(/'/g, "")}
                </option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Size</label>
              <input
                type="number"
                value={node.style.fontSize}
                onChange={(e) =>
                  updateStyle(node.id, { fontSize: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Color</label>
              <input
                type="color"
                value={node.style.color}
                onChange={(e) => updateStyle(node.id, { color: e.target.value })}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Style</label>
              <div className="toggle-row">
                <button
                  className={`icon-btn${node.style.bold ? " active" : ""}`}
                  title="Bold"
                  onClick={() => updateStyle(node.id, { bold: !node.style.bold })}
                >
                  <IconBold />
                </button>
                <button
                  className={`icon-btn${node.style.italic ? " active" : ""}`}
                  title="Italic"
                  onClick={() => updateStyle(node.id, { italic: !node.style.italic })}
                >
                  <IconItalic />
                </button>
                <button
                  className={`icon-btn${node.style.underline ? " active" : ""}`}
                  title="Underline"
                  onClick={() =>
                    updateStyle(node.id, { underline: !node.style.underline })
                  }
                >
                  <IconUnderline />
                </button>
              </div>
            </div>
            <div className="field">
              <label>Align</label>
              <IconToggleGroup<TextAlign>
                value={node.style.align}
                onChange={(align) => updateStyle(node.id, { align })}
                options={[
                  { value: "left", icon: IconAlignLeft, title: "Align left" },
                  { value: "center", icon: IconAlignCenter, title: "Align center" },
                  { value: "right", icon: IconAlignRight, title: "Align right" },
                ]}
              />
            </div>
          </div>

          <div className="field">
            <label>Link URL (optional)</label>
            <input
              placeholder="https://…"
              value={node.style.link}
              onChange={(e) => updateStyle(node.id, { link: e.target.value })}
            />
          </div>
        </>
      )}

      <h3>Appearance</h3>
      <div className="field">
        <label>Background</label>
        <div className="swatch-row">
          <input
            type="color"
            disabled={node.style.backgroundColor === "transparent"}
            value={node.style.backgroundColor === "transparent" ? "#ffffff" : node.style.backgroundColor}
            onChange={(e) => updateStyle(node.id, { backgroundColor: e.target.value })}
          />
          <button
            className={`chip-btn${node.style.backgroundColor === "transparent" ? " active" : ""}`}
            onClick={() =>
              updateStyle(node.id, {
                backgroundColor: node.style.backgroundColor === "transparent" ? "#ffffff" : "transparent",
              })
            }
          >
            None
          </button>
        </div>
      </div>

      <div className="field">
        <label>Border</label>
        <IconToggleGroup<BorderStyle>
          value={node.style.borderStyle}
          onChange={(borderStyle) => updateStyle(node.id, { borderStyle })}
          options={[
            { value: "none", icon: IconBorderNone, title: "No border" },
            { value: "solid", icon: IconBorderSolid, title: "Solid border" },
            { value: "dashed", icon: IconBorderDashed, title: "Dashed border" },
          ]}
        />
      </div>
      {node.style.borderStyle !== "none" && (
        <div className="field-row">
          <div className="field">
            <label>Width</label>
            <input
              type="number"
              min={1}
              value={node.style.borderWidth || 1}
              onChange={(e) =>
                updateStyle(node.id, { borderWidth: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Color</label>
            <input
              type="color"
              value={node.style.borderColor === "transparent" ? "#94a3b8" : node.style.borderColor}
              onChange={(e) => updateStyle(node.id, { borderColor: e.target.value })}
            />
          </div>
        </div>
      )}

      {container && (
        <>
          <h3>Layout</h3>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={node.layout !== null}
                onChange={(e) => toggleAutoLayout(node.id, e.target.checked)}
              />{" "}
              Auto-arrange contents
            </label>
          </div>
          {node.layout && (
            <div className="field">
              <label>Stack direction</label>
              <IconToggleGroup<Direction>
                value={node.layout.direction}
                onChange={(direction) => updateLayoutProps(node.id, { direction })}
                options={[
                  { value: "column", icon: IconStackColumn, title: "Stack top to bottom" },
                  { value: "row", icon: IconStackRow, title: "Stack side by side" },
                ]}
              />
            </div>
          )}
        </>
      )}

      {container && node.id !== "root" && (
        <RepeatSection
          node={node}
          listVariables={doc.variables.filter((v) => v.type === "list")}
          onChange={(repeat) => updateNode(node.id, { repeat })}
        />
      )}

      <details className="advanced-section">
        <summary>Advanced</summary>

        <div className="field-row">
          <div className="field">
            <label>X</label>
            <input
              type="number"
              value={Math.round(node.x)}
              disabled={!freeform}
              onChange={(e) => moveNode(node.id, Number(e.target.value), node.y)}
            />
          </div>
          <div className="field">
            <label>Y</label>
            <input
              type="number"
              value={Math.round(node.y)}
              disabled={!freeform}
              onChange={(e) => moveNode(node.id, node.x, Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>W{autoAxis === "w" ? " (auto)" : ""}</label>
            <input
              type="number"
              value={Math.round(node.w)}
              disabled={autoAxis === "w"}
              onChange={(e) => resizeNode(node.id, Number(e.target.value), node.h)}
            />
          </div>
          <div className="field">
            <label>H{autoAxis === "h" ? " (auto)" : ""}</label>
            <input
              type="number"
              value={Math.round(node.h)}
              disabled={autoAxis === "h"}
              onChange={(e) => resizeNode(node.id, node.w, Number(e.target.value))}
            />
          </div>
        </div>

        {!freeform && (
          <div className="field-row">
            <button onClick={() => reorderChild(node.id, -1)}>◀ Move earlier</button>
            <button onClick={() => reorderChild(node.id, 1)}>Move later ▶</button>
          </div>
        )}

        {container && node.layout && (
          <>
            <div className="field">
              <label>Gap</label>
              <input
                type="number"
                value={node.layout.gap}
                onChange={(e) =>
                  updateLayoutProps(node.id, { gap: Number(e.target.value) })
                }
              />
            </div>

            <div className="field">
              <label>Padding</label>
              <input
                type="number"
                value={node.layout.padding}
                onChange={(e) =>
                  updateLayoutProps(node.id, {
                    padding: Number(e.target.value),
                  })
                }
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label>Cross-axis align</label>
                <select
                  value={node.layout.align}
                  onChange={(e) =>
                    updateLayoutProps(node.id, { align: e.target.value as Align })
                  }
                >
                  <option value="start">Start</option>
                  <option value="center">Center</option>
                  <option value="end">End</option>
                  <option value="stretch">Stretch</option>
                </select>
              </div>
              <div className="field">
                <label>Distribute</label>
                <select
                  value={node.layout.justify}
                  onChange={(e) =>
                    updateLayoutProps(node.id, {
                      justify: e.target.value as Justify,
                    })
                  }
                >
                  <option value="start">Start</option>
                  <option value="center">Center</option>
                  <option value="end">End</option>
                  <option value="space-between">Space between</option>
                </select>
              </div>
            </div>
          </>
        )}
      </details>
    </div>
  );
}

function RepeatSection({
  node,
  listVariables,
  onChange,
}: {
  node: DesignNode;
  listVariables: TemplateVariable[];
  onChange: (repeat: RepeatDefinition | undefined) => void;
}) {
  const enabled = Boolean(node.repeat?.over);
  const selectedList = listVariables.find((v) => v.name === node.repeat?.over);
  const alias = node.repeat?.as || "item";
  const sampleField = selectedList?.itemSchema?.[0]?.name || "name";

  return (
    <div className="repeat-section">
      <h3>Repeat this box</h3>
      <p className="inspector-hint repeat-intro">
        Use this when the box is a <strong>row template</strong> (a line item, a transaction, etc.).
        FileWorks clones the box once for every entry in a <strong>List</strong> variable.
      </p>

      <div className="field">
        <label>Which list to loop over</label>
        <select
          value={node.repeat?.over || ""}
          disabled={listVariables.length === 0}
          onChange={(e) => {
            const over = e.target.value;
            onChange(over ? { over, as: node.repeat?.as || "item" } : undefined);
          }}
        >
          <option value="">
            {listVariables.length === 0
              ? "No List variables — add one in Variables"
              : "Don’t repeat (show once)"}
          </option>
          {listVariables.map((v) => (
            <option key={v.id} value={v.name}>
              {v.label} ({v.name})
            </option>
          ))}
        </select>
      </div>

      {enabled ? (
        <>
          <div className="field">
            <label>Call each row</label>
            <input
              placeholder="item"
              value={alias}
              onChange={(e) =>
                onChange(node.repeat ? { ...node.repeat, as: e.target.value || "item" } : undefined)
              }
            />
          </div>
          <div className="repeat-example">
            <p className="inspector-hint">
              Inside this box, reference fields as{" "}
              <code className="var-token">{`{{ ${alias}.${sampleField} }}`}</code>
              {selectedList?.itemSchema && selectedList.itemSchema.length > 1
                ? `, {{ ${alias}.${selectedList.itemSchema[1].name} }}, …`
                : ""}
              .
            </p>
            <p className="inspector-hint">
              Example: list <code>{selectedList?.name || "items"}</code> with alias{" "}
              <code>{alias}</code> → one copy of this box per row at generate / Output preview.
            </p>
          </div>
        </>
      ) : (
        <p className="inspector-hint">
          Tip: create a <strong>List</strong> in Variables (e.g. line items), put headings/amounts
          inside this box, then choose that list here.
        </p>
      )}
    </div>
  );
}
