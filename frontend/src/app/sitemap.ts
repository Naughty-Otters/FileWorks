import type { MetadataRoute } from "next";
import { absoluteUrl, INDEXABLE_ROUTES } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Build-time timestamp — better freshness signal than a fixed historical date.
  const lastModified = new Date();
  return INDEXABLE_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
