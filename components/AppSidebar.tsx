"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { UserMenu } from "./UserMenu";
import { brandFor } from "@/lib/brand";

type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(d: string): ComponentType<IconProps> {
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d={d} />
      </svg>
    );
  }
  return Icon;
}

type Item = {
  href: string;
  label: string;
  color: string;
  Icon: ComponentType<IconProps>;
  adminOnly?: boolean;
  superadminOnly?: boolean;
  approverOnly?: boolean;
};

// Grouped like Nudge: a general set, then an admin set, divided by a rule.
const GROUPS: Item[][] = [
  [
    { href: "/", label: "Dashboard", color: "#3b82f6", Icon: makeIcon("M3 12l9-9 9 9M5 10v10h14V10") },
    { href: "/requests", label: "My Leave", color: "#10b981", Icon: makeIcon("M8 7V3M16 7V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z") },
    { href: "/calendar", label: "Team Calendar", color: "#f59e0b", Icon: makeIcon("M8 7V3M16 7V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z") },
    { href: "/employees", label: "Employees", color: "#06b6d4", superadminOnly: true, Icon: makeIcon("M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75") },
    { href: "/departments", label: "Offices", color: "#0ea5e9", superadminOnly: true, Icon: makeIcon("M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 13v.01M9 17v.01") },
  ],
  [
    { href: "/approvals", label: "Approvals", color: "#f97316", approverOnly: true, Icon: makeIcon("M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z") },
    { href: "/reports", label: "Reports", color: "#8b5cf6", approverOnly: true, Icon: makeIcon("M18 20V10M12 20V4M6 20v-6") },
    { href: "/activity", label: "Activity", color: "#ec4899", superadminOnly: true, Icon: makeIcon("M22 12h-4l-3 9L9 3l-3 9H2") },
    { href: "/settings", label: "Time-off configuration", color: "#64748b", superadminOnly: true, Icon: makeIcon("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6") },
    { href: "/admin", label: "Admins", color: "#14b8a6", superadminOnly: true, Icon: makeIcon("M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z") },
  ],
];

const ACTIVE_BG = "color-mix(in srgb, var(--foreground) 8%, transparent)";

// Standard sidebar-toggle glyph (lucide "panel-left"): a panel with a left
// rail. Used everywhere we collapse/expand a sidebar — same symbol every time.
const PanelLeft = makeIcon("M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM9 3v18");
const Close = makeIcon("M18 6L6 18M6 6l12 12");

export function AppSidebar({
  isAdmin,
  isSuperadmin,
  isApprover,
  isDemo,
  pending,
  collapsed,
  animate = true,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  isAdmin: boolean;
  isSuperadmin: boolean;
  isApprover: boolean;
  isDemo: boolean;
  pending: number;
  collapsed: boolean;
  animate?: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const brand = brandFor(isDemo);

  const groups = GROUPS.map((g) =>
    g.filter((it) => {
      if (it.adminOnly && !isAdmin) return false;
      if (it.superadminOnly && !isSuperadmin) return false;
      if (it.approverOnly && !isApprover) return false;
      return true;
    }),
  ).filter((g) => g.length > 0);

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        tabIndex={mobileOpen ? 0 : -1}
        aria-label="Close menu"
        onClick={onCloseMobile}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col overflow-hidden transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } app-pane md:static md:h-auto md:translate-x-0 md:self-stretch md:rounded-xl md:border md:border-border ${
          animate ? "md:transition-[width]" : ""
        } ${
          collapsed ? "md:w-[4.5rem]" : "md:w-[16rem]"
        }`}
      >
        {/* Brand header — h-14, flush with the page header */}
        <div
          className={`flex h-14 shrink-0 items-center justify-between pl-4 pr-3 ${
            collapsed ? "md:justify-center md:px-0" : ""
          }`}
        >
          <Link
            href="/"
            onClick={onCloseMobile}
            className={`flex items-center gap-2.5 ${collapsed ? "md:hidden" : ""}`}
          >
            <Image
              src={brand.logo}
              alt={brand.org}
              width={26}
              height={26}
              className="shrink-0"
            />
            <div className="leading-tight">
              <div className="text-base font-semibold text-foreground">
                Time Off
              </div>
              <div className="text-[11px] text-muted">
                {brand.handle}
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded p-0.5 text-muted transition-colors hover:bg-black/[0.045] hover:text-foreground md:inline-flex dark:hover:bg-white/[0.05]"
          >
            <PanelLeft />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close menu"
            className="-mr-1 rounded p-1 text-muted hover:bg-black/[0.045] hover:text-foreground md:hidden dark:hover:bg-white/[0.05]"
          >
            <Close />
          </button>
        </div>

        <nav className="thin-scroll flex-1 overflow-y-auto py-3">
          {groups.map((group, i) => (
            <div key={group[0].href}>
              {i > 0 && <div className="mx-4 my-2 border-t border-border" />}
              <ul className="space-y-0.5 px-2">
                {group.map((it) => {
                  const active =
                    it.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(it.href);
                  const badge =
                    it.href === "/approvals" && pending > 0 ? pending : null;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        onClick={onCloseMobile}
                        title={collapsed ? it.label : undefined}
                        aria-current={active ? "page" : undefined}
                        style={active ? { backgroundColor: ACTIVE_BG } : undefined}
                        className={`group relative flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                          collapsed ? "md:justify-center md:px-0" : ""
                        } ${
                          active
                            ? "font-semibold text-foreground"
                            : "font-medium text-muted-strong hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.05]"
                        }`}
                      >
                        <it.Icon
                          className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
                          style={{ color: it.color, opacity: active ? 1 : undefined }}
                        />
                        <span className={`flex-1 truncate ${collapsed ? "md:hidden" : ""}`}>
                          {it.label}
                        </span>
                        {badge !== null && (
                          <>
                            <span className={`rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg ${collapsed ? "md:hidden" : ""}`}>
                              {badge}
                            </span>
                            {collapsed && (
                              <span className="absolute right-1.5 top-1.5 hidden h-2 w-2 rounded-full bg-accent md:block" />
                            )}
                          </>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {isDemo && (
          <div className={`shrink-0 px-4 pb-2 text-[11px] text-muted ${collapsed ? "md:hidden" : ""}`}>
            <div>Demo environment · resets nightly</div>
            <a
              href={process.env.NEXT_PUBLIC_HELP_CENTER_URL ?? "/help"}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-medium text-foreground hover:opacity-70"
            >
              Help center
            </a>
          </div>
        )}

        {/* Account, pinned to the foot — next to Settings, which is mostly what
            it opens. Its menu portals out of this pane; see UserMenu. */}
        <div className="shrink-0 p-2">
          <UserMenu collapsed={collapsed} onNavigate={onCloseMobile} />
        </div>
      </aside>
    </>
  );
}

export function MenuIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
