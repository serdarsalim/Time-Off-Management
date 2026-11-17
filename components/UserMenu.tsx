"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import {
  useImpersonatedUserId,
  stopImpersonation,
  getReturnPath,
} from "@/lib/impersonation";
import { useTheme } from "@/lib/useTheme";
import { useAnchoredMenu } from "@/lib/useAnchoredMenu";
import type { ThemeMode } from "@/lib/theme";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
  {
    value: "auto",
    label: "Auto (follows sunrise & sunset)",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        <path d="M12 8a4 4 0 0 0 0 8z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

// The account control, pinned to the foot of the sidebar. It used to be an
// avatar in the top-right of the header; it lives here because what it opens —
// your profile, appearance, sign out — is workspace chrome, and the sidebar is
// where this app keeps workspace chrome. The bell stays in the header: that's
// about incoming events, not about you.
//
// The menu opens UPWARD through a portal, and both halves matter. The sidebar
// clips its overflow, so an absolutely-positioned menu would be cut at the
// sidebar's edge whatever its z-index; and a downward menu from an anchor
// pinned to the bottom would open off the screen.
export function UserMenu({
  collapsed = false,
  onNavigate,
}: {
  // Collapsed rail: avatar only. Same rule the nav labels follow, so the rail
  // stays one icon wide.
  collapsed?: boolean;
  // Closes the mobile drawer when a menu item navigates away, matching every
  // nav row above it.
  onNavigate?: () => void;
} = {}) {
  const me = useQuery(api.users.me);
  const impersonatedId = useImpersonatedUserId();
  const impersonating = !!impersonatedId;
  // While impersonating, the menu reflects the person being acted as.
  const target = useQuery(
    api.users.getById,
    impersonatedId ? { userId: impersonatedId } : "skip",
  );
  const acting = impersonating ? target : me;
  const { signOut } = useAuthActions();
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const { open, setOpen, anchorRef, menuRef, pos, ready } =
    useAnchoredMenu<HTMLButtonElement>({ placement: "above", width: 256 });

  // Two-letter initials from the displayed name (e.g. "Gez Makan" → "GM"),
  // falling back to "·" before it loads.
  const initial = (() => {
    const parts = (acting?.name ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "·";
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  })();
  const firstName = (acting?.name ?? "").trim().split(/\s+/)[0] || "";

  function exitImpersonation() {
    const back = getReturnPath();
    stopImpersonation();
    setOpen(false);
    router.push(back ?? "/");
  }

  const menu = (
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: pos?.width,
              // Rendered but invisible for the one frame before its height is
              // measurable — otherwise the upward placement visibly corrects.
              visibility: ready ? "visible" : "hidden",
            }}
            className="z-50 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                {impersonating && (
                  <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Acting as
                  </div>
                )}
                <div className="truncate text-sm font-medium text-foreground">
                  {acting?.name}
                </div>
                <div className="truncate text-xs text-muted">
                  {acting?.email}
                </div>
              </div>
              {acting && (
                <span className="rounded-full bg-muted-bg px-2 py-0.5 text-[10px] font-medium capitalize text-muted">
                  {acting.role}
                </span>
              )}
            </div>

            {/* Items */}
            <div className="p-1">
              {impersonating ? (
                <Link
                  href={`/employees/${impersonatedId}`}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-muted-bg"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Their profile
                </Link>
              ) : (
                <Link
                  href="/account"
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-muted-bg"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Account
                </Link>
              )}

              <div className="flex items-center justify-between gap-2.5 px-2.5 py-2 text-sm text-foreground">
                <span>Theme</span>
                <div className="inline-flex items-center gap-0.5 rounded-md bg-muted-bg p-0.5">
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      aria-label={opt.label}
                      aria-pressed={mode === opt.value}
                      title={opt.label}
                      className={`flex h-6 w-7 items-center justify-center rounded transition-colors ${
                        mode === opt.value
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {opt.icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-border p-1">
              {impersonating ? (
                <button
                  onClick={exitImpersonation}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  {firstName ? `Exit acting as ${firstName}` : "Exit acting as"}
                </button>
              ) : (
                <button
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-muted-bg"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  Sign out
                </button>
              )}
            </div>
          </div>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        title={collapsed ? (acting?.name ?? "Account") : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.05] ${
          collapsed ? "md:justify-center" : ""
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {initial}
        </span>
        <span className={`min-w-0 flex-1 leading-tight ${collapsed ? "md:hidden" : ""}`}>
          {impersonating && (
            <span className="block text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Acting as
            </span>
          )}
          <span className="block truncate text-sm font-medium text-foreground">
            {acting?.name}
          </span>
          <span className="block truncate text-xs text-muted">
            {acting?.email}
          </span>
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </>
  );
}
