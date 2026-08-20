import path from "node:path";
import type { NextConfig } from "next";
import type { Configuration as WebpackConfig } from "webpack";

const staticExport = process.env.FILEWORKS_STATIC_EXPORT === "1";
const emptyPolyfill = path.join(__dirname, "src/lib/empty-polyfill.ts");

// Next always pulls polyfill-module from app-globals. Package-path aliases do
// not always match that relative request (especially under webpack), so we
 // map both the public package paths and rewrite relative polyfill requires.
const polyfillPackageAliases: Record<string, string> = {
  "next/dist/build/polyfills/polyfill-module": emptyPolyfill,
  "next/dist/esm/build/polyfills/polyfill-module": emptyPolyfill,
  "next/dist/build/polyfills/polyfill-nomodule": emptyPolyfill,
  "next/dist/esm/build/polyfills/polyfill-nomodule": emptyPolyfill,
};

const polyfillTurbopackAliases: Record<string, string> = {
  "../build/polyfills/polyfill-module": emptyPolyfill,
  "../build/polyfills/polyfill-nomodule": emptyPolyfill,
  ...polyfillPackageAliases,
};

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
  // Keep tooling rooted at the frontend package (nested git / monorepo safety).
  turbopack: {
    root: __dirname,
    resolveAlias: polyfillTurbopackAliases,
  },
  webpack(config: WebpackConfig, { webpack }) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string | false | string[]>),
      ...polyfillPackageAliases,
    };
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /[\\/]next[\\/]dist[\\/](?:esm[\\/])?build[\\/]polyfills[\\/]polyfill-(?:no)?module(?:\.js)?$/,
        emptyPolyfill,
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
