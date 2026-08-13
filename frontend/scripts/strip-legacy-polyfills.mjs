import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function walk(dir, acc = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const scriptRe = /<script\b[^>]*\bnomodule\b[^>]*><\/script>/gi;
let htmlStripped = 0;
for (const dir of [join(root, "out"), join(root, ".next")]) {
  for (const file of walk(dir)) {
    if (!file.endsWith(".html")) continue;
    const before = readFileSync(file, "utf8");
    const after = before.replace(scriptRe, "");
    if (after !== before) {
      writeFileSync(file, after);
      htmlStripped += 1;
    }
  }
}

let polyfillRemoved = 0;
for (const manifest of [
  join(root, ".next", "build-manifest.json"),
  join(root, "out", "_next", "build-manifest.json"),
]) {
  let raw;
  try {
    raw = readFileSync(manifest, "utf8");
  } catch {
    continue;
  }
  const json = JSON.parse(raw);
  const files = Array.isArray(json.polyfillFiles) ? json.polyfillFiles : [];
  for (const rel of files) {
    for (const base of [join(root, ".next"), join(root, "out", "_next")]) {
      const abs = join(base, rel);
      try {
        rmSync(abs, { force: true });
        polyfillRemoved += 1;
      } catch {
        // already gone
      }
    }
  }
  json.polyfillFiles = [];
  writeFileSync(manifest, JSON.stringify(json, null, 2));
}

console.log(
  `strip-legacy-polyfills: removed nomodule script from ${htmlStripped} HTML file(s), deleted ${polyfillRemoved} polyfill chunk(s).`,
);
