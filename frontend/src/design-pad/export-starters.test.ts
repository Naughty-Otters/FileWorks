import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATE_CATEGORIES } from "./templates";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../../backend/app/processing/template/starters/data");

describe("export builtin starters", () => {
  it("writes catalog + documents for the API", () => {
    mkdirSync(outDir, { recursive: true });
    const catalog = {
      version: 1,
      categories: TEMPLATE_CATEGORIES,
      starters: TEMPLATES.map((t) => {
        const doc = t.build();
        const path = `${t.id}.json`;
        writeFileSync(join(outDir, path), `${JSON.stringify(doc, null, 2)}\n`);
        return {
          id: t.id,
          name: t.label,
          description: t.description,
          category: t.category,
          document_file: path,
          variables: doc.variables.map((v) => ({
            name: v.name,
            label: v.label,
            type: v.type,
            sampleValue: v.sampleValue,
            itemSchema: v.itemSchema || [],
          })),
          pageSize: doc.pageSize,
        };
      }),
    };
    writeFileSync(join(outDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    expect(catalog.starters.length).toBeGreaterThanOrEqual(16);
  });
});
