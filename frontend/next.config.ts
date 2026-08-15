const staticExport = process.env.FILEWORKS_STATIC_EXPORT === "1";
const emptyPolyfill = "./src/lib/empty-polyfill.ts";

// Next always `require("../build/polyfills/polyfill-module")` from app-globals.
// Package-path aliases do not match that relative request, so Lighthouse still
// sees Array.prototype.at / Object.hasOwn / etc. in the client bundle.
const polyfillAliases = {
  "../build/polyfills/polyfill-module": emptyPolyfill,
  "../build/polyfills/polyfill-nomodule": emptyPolyfill,
  "next/dist/build/polyfills/polyfill-module": emptyPolyfill,
  "next/dist/esm/build/polyfills/polyfill-module": emptyPolyfill,
  "next/dist/build/polyfills/polyfill-nomodule": emptyPolyfill,
  "next/dist/esm/build/polyfills/polyfill-nomodule": emptyPolyfill,
};

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  // Keep tooling rooted at the frontend package (nested git / monorepo safety).
  turbopack: {
    root: __dirname,
    resolveAlias: polyfillAliases,
  },
  webpack(config: { resolve: { alias?: Record<string, string> } }) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...polyfillAliases,
    };
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
