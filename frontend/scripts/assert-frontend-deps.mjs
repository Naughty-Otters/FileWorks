import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const missing = [];
for (const name of Object.keys(pkg.dependencies || {})) {
  try {
    require.resolve(name);
  } catch {
      missing.push(name);
  }
}

if (missing.length) {
  console.error(
    `Missing npm packages: ${missing.join(", ")}.\n` +
      `Run: cd frontend && npm install`,
  );
  process.exit(1);
}

// Guard: turbopack resolveAlias must not use absolute filesystem paths —
// those become "server relative" imports (`./Users/...`) and break builds.
const configPath = join(root, "next.config.ts");
if (!existsSync(configPath)) process.exit(0);

const src = readFileSync(configPath, "utf8");
const turbopackMatch = src.match(/\bturbopack\s*:\s*\{/);
if (!turbopackMatch || turbopackMatch.index === undefined) process.exit(0);

let depth = 0;
let end = -1;
for (let i = turbopackMatch.index + turbopackMatch[0].length - 1; i < src.length; i++) {
  const ch = src[i];
  if (ch === "{") depth += 1;
  else if (ch === "}") {
    depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
if (end < 0) process.exit(0);

const turbopackBlock = src.slice(turbopackMatch.index, end + 1);
if (
  /emptyPolyfillAbsolute/.test(turbopackBlock) ||
  /path\.join\(\s*__dirname/.test(turbopackBlock) ||
  /resolveAlias[\s\S]*['"]\/Users\//.test(turbopackBlock) ||
  /resolveAlias[\s\S]*['"]\/[A-Za-z]/.test(turbopackBlock)
) {
  console.error(
    "next.config.ts: turbopack.resolveAlias must use a project-relative path " +
      "(e.g. ./src/lib/empty-polyfill.ts), not an absolute filesystem path.",
  );
  process.exit(1);
}
