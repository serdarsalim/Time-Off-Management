import { BRAND } from "@/lib/brand";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";
import { AccessGate } from "@/components/AccessGate";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const IS_PUBLIC_DEMO = BRAND.indexable;
const SITE_URL = BRAND.siteUrl;
const TITLE = BRAND.appName;
const DESCRIPTION = BRAND.description;
const OG_IMAGE = BRAND.ogImage;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  robots: IS_PUBLIC_DEMO
    ? { index: true, follow: true }
    : { index: false, follow: false },
  // Without an og:image, scrapers fall back to the near-square favicon and
  // WhatsApp/Slack blow it up into a full-width block. /og.png is the standard
  // 1200x630 card — regenerate it with scripts/make-og-image.py. It lives in
  // public/ (not app/opengraph-image.tsx) so the dot in the filename keeps it
  // outside the middleware matcher; a route without one would redirect the
  // scraper to /login and there'd be no preview at all.
  openGraph: {
    type: "website",
    url: "/",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

// Set the theme class before paint to avoid a flash. For "auto" we trust the
// dark value the client cached last time (theme-dark); useTheme recomputes the
// exact sunrise/sunset state on mount. Legacy "dark"/"light" still work.
const themeScript = `(function(){try{var m=localStorage.getItem('theme');var d;if(m==='dark'){d=true;}else if(m==='light'){d=false;}else if(m==='auto'){var r=localStorage.getItem('theme-dark');d=r==null?window.matchMedia('(prefers-color-scheme:dark)').matches:r==='1';}else{d=window.matchMedia('(prefers-color-scheme:dark)').matches;}if(d){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-screen font-sans">
          <ConvexClientProvider>
            <AccessGate>{children}</AccessGate>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
