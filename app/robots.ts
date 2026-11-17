import type { MetadataRoute } from "next";

const IS_PUBLIC_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const DEMO_ORIGIN = "https://time-off.autotakt.dev";

export default function robots(): MetadataRoute.Robots {
  if (!IS_PUBLIC_DEMO) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login"],
      disallow: ["/admin/", "/api/"],
    },
    sitemap: `${DEMO_ORIGIN}/sitemap.xml`,
    host: DEMO_ORIGIN,
  };
}
