import path from "node:path";
import type { NextConfig } from "next";

const staticExport = process.env.FILEWORKS_STATIC_EXPORT === "1";

// Turbopack treats absolute `/...` alias targets as server-relative imports
// ("server relative imports are not implemented yet" / `./Users/...`).
// Always use a project-relative target for turbopack; webpack is fine with abs paths.
const emptyPolyfillRelative = "./src/lib/empty-polyfill.ts";
const emptyPolyfillAbsolute = path.join(__dirname, "src/lib/empty-polyfill.ts");
const mammothBrowserRelative = "./node_modules/mammoth/mammoth.browser.js";
const mammothBrowserAbsolute = path.join(__dirname, "node_modules/mammoth/mammoth.browser.js");

const mammothAliasesRelative: Record<string, string> = {
  mammoth: mammothBrowserRelative,
  "mammoth/mammoth.browser.js": mammothBrowserRelative,
  "mammoth/mammoth.browser.min.js": mammothBrowserRelative,
};

const mammothAliasesAbsolute: Record<string, string> = {
  mammoth: mammothBrowserAbsolute,
  "mammoth/mammoth.browser.js": mammothBrowserAbsolute,
  "mammoth/mammoth.browser.min.js": mammothBrowserAbsolute,
};

// Next always pulls polyfill-module from app-globals. Package-path aliases do
// not always match that relative request (especially under webpack), so we
// map both the public package paths and rewrite relative polyfill requires.
const polyfillKeys = [
  "next/dist/build/polyfills/polyfill-module",
  "next/dist/esm/build/polyfills/polyfill-module",
  "next/dist/build/polyfills/polyfill-nomodule",
  "next/dist/esm/build/polyfills/polyfill-nomodule",
] as const;

function aliasMap(target: string): Record<string, string> {
  return Object.fromEntries(polyfillKeys.map((key) => [key, target]));
}

const nextConfig: NextConfig = {
  ...(staticExport
    ? {
        output: "export" as const,
        images: { unoptimized: true },
      }
    : {}),
  poweredByHeader: false,
  compiler: {
    removeConsole: {
      exclude: ["error", "warn"],
    },
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // mammoth's package "main" is Node-oriented; browser field + alias below.
  transpilePackages: ["pdfjs-dist", "mammoth"],
  // Keep tooling rooted at the frontend package (nested git / monorepo safety).
  turbopack: {
    root: __dirname,
    resolveAlias: {
      "../build/polyfills/polyfill-module": emptyPolyfillRelative,
      "../build/polyfills/polyfill-nomodule": emptyPolyfillRelative,
      ...aliasMap(emptyPolyfillRelative),
      // Pin Mammoth to the browserify bundle (package "main" is Node-only).
      ...mammothAliasesRelative,
    },
  },
  webpack(config, { webpack }) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string | false | string[]>),
      ...aliasMap(emptyPolyfillAbsolute),
      ...mammothAliasesAbsolute,
    };
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /[\\/]next[\\/]dist[\\/](?:esm[\\/])?build[\\/]polyfills[\\/]polyfill-(?:no)?module(?:\.js)?$/,
        emptyPolyfillAbsolute,
      ),
    );
    return config;
  },
  // Omitted entirely for `output: export`, which warns about any rewrites key.
  ...(staticExport
    ? {}
    : {
        async rewrites() {
          const api = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";
          return [
            {
              source: "/api/:path*",
              destination: `${api}/api/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
