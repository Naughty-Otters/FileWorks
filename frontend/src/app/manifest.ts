import type { MetadataRoute } from "next";
import { BUSINESS_NAME } from "@/lib/legal";

// `output: export` requires metadata routes to be statically rendered.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BUSINESS_NAME,
    short_name: BUSINESS_NAME,
    description: "Convert PDFs, office files, images, and scans into editable Markdown.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#0f6e56",
    icons: [
      { src: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icons/icon-512-dark.png", sizes: "512x512", type: "image/png" },
    ],
    id: "/",
  };
}
