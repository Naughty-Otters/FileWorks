/**
 * Dump built-in DesignDocument starters to backend fixtures so the API
 * can list/render them with variables without depending on the FE bundle.
 *
 * Usage: node --experimental-strip-types scripts/export-builtin-templates.mjs
 * (or: npx vitest run scripts/export-builtin-templates.test.ts)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../../backend/app/processing/template/starters/data");

async function main() {
  const { TEMPLATES, TEMPLATE_CATEGORIES } = await import("../src/design-pad/templates.ts");
  mkdirSync(outDir, { recursive: true });
  const catalog = {
    version: 1,
    categories: TEMPLATE_CATEGORIES,
    starters: TEMPLATES.map((t) => {
      const doc = t.build();
      const path = `${t.id}.json`;
      writeFileSync(join(outDir, path), JSON.stringify(doc, null, 2) + "\n");
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
  writeFileSync(join(outDir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Exported ${catalog.starters.length} starters → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
