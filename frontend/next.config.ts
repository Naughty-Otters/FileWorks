import path from "node:path";
import type { NextConfig } from "next";

const staticExport = process.env.FILEWORKS_STATIC_EXPORT === "1";

// Turbopack treats absolute `/...` alias targets as server-relative imports
// ("server relative imports are not implemented yet" / `./Users/...`).
// Always use a project-relative target for turbopack; webpack is fine with abs paths.
const emptyPolyfillRelative = "./src/lib/empty-polyfill.ts";
const emptyPolyfillAbsolute = path.join(__dirname, "src/lib/empty-polyfill.ts");

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
  transpilePackages: ["pdfjs-dist"],
  // Keep tooling rooted at the frontend package (nested git / monorepo safety).
  turbopack: {
    root: __dirname,
    resolveAlias: {
      "../build/polyfills/polyfill-module": emptyPolyfillRelative,
      "../build/polyfills/polyfill-nomodule": emptyPolyfillRelative,
      ...aliasMap(emptyPolyfillRelative),
    },
  },
  webpack(config, { webpack }) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string | false | string[]>),
      ...aliasMap(emptyPolyfillAbsolute),
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
