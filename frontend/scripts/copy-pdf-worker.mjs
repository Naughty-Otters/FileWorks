import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Copy pdf.js worker into public/. Safe to run before the rest of the tree
 * exists (Docker layer that only has package.json + scripts).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
];
const src = candidates.find((path) => existsSync(path));
const destDir = join(root, "public");
const dest = join(destDir, "pdf.worker.min.mjs");

if (!src) {
  console.warn("pdfjs-dist worker not found; skip copy");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied pdf worker → ${pathToFileURL(dest).pathname}`);
