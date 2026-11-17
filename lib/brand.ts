// Whose workspace this deployment is. The public demo runs as Autotakt's; a
// self-hosted install takes its name and address from NEXT_PUBLIC_* env vars.
//
// One source of truth on purpose: the strings live together instead of as
// ternaries scattered across layout, login, sidebar and onboarding.

export type Brand = {
  /** Organisation running this workspace. */
  org: string;
  /** Full product name, e.g. for the login heading and the tab title. */
  appName: string;
  /** Short org handle under the product name in the sidebar. */
  handle: string;
  /** Mark shown beside the product name. */
  logo: string;
  /** Canonical origin for metadata. */
  siteUrl: string;
  description: string;
  ogImage: string;
  /** Public demos are indexable; a private customer workspace never is. */
  indexable: boolean;
};

const AUTOTAKT_DEMO: Brand = {
  org: "Autotakt",
  appName: "Autotakt Time Off",
  handle: "@Autotakt",
  logo: "/autotakt-mark.png",
  siteUrl: "https://time-off.autotakt.dev",
  description:
    "Leave requests, approvals, balances and the team calendar in one place.",
  ogImage: "/og-demo.png",
  indexable: true,
};

const ORG = process.env.NEXT_PUBLIC_ORG_NAME || "Your company";

const SELF_HOSTED: Brand = {
  org: ORG,
  appName: `${ORG} Time Off`,
  handle: `@${ORG}`,
  logo: process.env.NEXT_PUBLIC_LOGO_URL || "/time-off-logo.svg",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3016",
  description: `Leave management for ${ORG}`,
  ogImage: "/og.png",
  indexable: false,
};

/** Build-time flag. Metadata is static, so it can only read this one. */
export const IS_PUBLIC_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * Client components resolve the brand from the runtime `isDemo` (which also
 * consults the Convex deployment), so a deployment whose Vercel flag and Convex
 * flag disagree still renders one consistent identity rather than a mix.
 */
export function brandFor(isDemo: boolean): Brand {
  return isDemo ? AUTOTAKT_DEMO : SELF_HOSTED;
}

export const BRAND = brandFor(IS_PUBLIC_DEMO);
