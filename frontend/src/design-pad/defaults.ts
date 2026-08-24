import type { TemplateVariable, VariableType } from "./types";

/** Built-in fallbacks when a variable has no default value set. */
export function typeDefaultValue(type: VariableType): string {
  switch (type) {
    case "list":
      return "[]";
    case "object":
      return "{}";
    case "number":
      return "0";
    case "currency":
      return "$0.00";
    case "date":
      return new Date().toLocaleDateString();
    case "image":
      return "";
    default:
      return "";
  }
}

/** Effective default: declared sampleValue (default value), else a type/label fallback. */
export function effectiveDefault(variable: TemplateVariable): string {
  const trimmed = variable.sampleValue?.trim() ?? "";
  if (trimmed) return trimmed;
  const typed = typeDefaultValue(variable.type);
  if (typed) return typed;
  // Text/date with no sample — use the label so preview still shows a document.
  if (variable.type === "text" || variable.type === "date") {
    return variable.label?.trim() || variable.name;
  }
  return "";
}
