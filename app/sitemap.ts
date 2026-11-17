import type { MetadataRoute } from "next";

const IS_PUBLIC_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!IS_PUBLIC_DEMO) return [];

  return [
    {
      url: "https://time-off.autotakt.dev",
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
