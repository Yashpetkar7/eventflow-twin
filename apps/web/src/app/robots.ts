import type { MetadataRoute } from "next";

// The public demo is a research prototype: keep it out of search results.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
