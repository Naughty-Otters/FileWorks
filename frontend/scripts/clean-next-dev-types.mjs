import { rmSync } from "node:fs";
import { join } from "node:path";

// `next dev` writes typed-route stubs under .next/dev/types. A later
// `next build` type-checks that folder via tsconfig, so leftover files for
// deleted pages (e.g. app/templates) fail the production build.
rmSync(join(process.cwd(), ".next", "dev"), { recursive: true, force: true });
