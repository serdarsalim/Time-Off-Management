"use client";

import { ReactNode, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppSidebar, MenuIcon } from "./AppSidebar";
import { HeaderSearch } from "./HeaderSearch";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { NotificationBell } from "./NotificationBell";
import { Onboarding } from "./Onboarding";
import { useImpersonatedUserId } from "@/lib/impersonation";
import {
  useSidebarCollapsed,
  setSidebarCollapsed,
  sidebarSettled,
  markSidebarSettled,
} from "@/lib/sidebar";

export function AppShell({
  children,
  headerActions,
  search,
  title,
  titleInfo,
}: {
  children: ReactNode;
  headerActions?: ReactNode;
  // Optional search box, in the right-hand cluster ahead of the action icons.
  // Shown only when a page provides the slot.
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  // The page title, hoisted OUT of each view and into the navbar's left slot.
  // Views used to carry their own h1 on a dedicated row, costing ~48px on every
  // tab for something the 56px navbar was already tall enough to hold.
  title?: string;
  // Explanatory copy for the title, behind an (i) — for the tabs whose title
  // row carried an InfoHint, so it isn't lost to the hoist.
  titleInfo?: ReactNode;
}) {
  const me = useQuery(api.users.me);
  const demoDeployment = useQuery(api.demo.isDemo) === true;
  const isDemo =
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" || demoDeployment;
  const impersonatedId = useImpersonatedUserId();
  // Acting as someone means seeing what THEY see, so the nav and its badge
  // follow the impersonated person's role, not the impersonator's.
  const actingAs = useQuery(
    api.users.getById,
    impersonatedId ? { userId: impersonatedId } : "skip",
  );
  const pending = useQuery(api.leave.pendingApprovals, {
    asUserId: impersonatedId ?? undefined,
  });

  const collapsed = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Hold the width transition until the stored value has been applied once, so
  // the post-hydration correction on a hard refresh snaps rather than animates.
  const [animate, setAnimate] = useState(sidebarSettled);
  useEffect(() => {
    markSidebarSettled();
    setAnimate(true);
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (typeof document === "undefined" || !mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  function toggleCollapse() {
    setSidebarCollapsed(!collapsed);
  }

  // Hold a neutral loading state until we know the user — and, while acting as
  // someone, until we know their role, so the nav doesn't flash the wrong tabs.
  if (me === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pane">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }

  if (impersonatedId && actingAs === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pane">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }

  // Unapproved members get the onboarding gate.
  if (
    me &&
    me.role === "member" &&
    (me.status === "pending" || me.status === "rejected")
  ) {
    return <Onboarding me={me} />;
  }

  // The role the UI reflects: the impersonated person's while acting as them.
  // Admins get the people surfaces (Employees, Offices) and approve; office
  // managers approve only; company config is superadmin-only below.
  const role = (impersonatedId ? actingAs?.role : me?.role) ?? "member";
  const showAdminNav = role === "admin" || role === "superadmin";
  // Company configuration and the company-wide activity log are superadmin
  // territory — an admin runs their own team, not the rules everyone works to.
  const showSuperadminNav = role === "superadmin";
  const showApproverNav = showAdminNav || role === "office_manager";

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-pane md:gap-2 md:p-2">
      <AppSidebar
        isAdmin={showAdminNav}
        isSuperadmin={showSuperadminNav}
        isApprover={showApproverNav}
        isDemo={isDemo}
        pending={pending?.length ?? 0}
        collapsed={collapsed}
        animate={animate}
        onToggleCollapsed={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The content PLANE — a faint wash the cards float on as lifted
            paper. The frame keeps the bigger radius (frame > card) and drops
            its border: the wash and the card shadows carry the separation
            now, and a line would draw the edge twice. Matches Resepta. */}
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[image:var(--content-bg)] md:rounded-xl md:shadow-[var(--card-shadow)]">
          <ImpersonationBanner />

          {/* Top header — h-14, flush with the sidebar brand */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className="-ml-1 rounded-md p-1.5 text-muted transition-colors hover:bg-muted-bg hover:text-foreground md:hidden"
              >
                <MenuIcon />
              </button>
              {title && (
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-foreground">
                    {title}
                  </h1>
                  {titleInfo}
                </div>
              )}
            </div>
            {/* While impersonating, the bell reflects the person being
                impersonated, so the header matches the body. The account menu
                is the sidebar's foot now — it's workspace chrome, and that's
                where this app keeps workspace chrome. */}
            <div className="flex items-center gap-3.5">
              {search && (
                <HeaderSearch
                  value={search.value}
                  onChange={search.onChange}
                  placeholder={search.placeholder}
                />
              )}
              {headerActions}
              <NotificationBell />
            </div>
          </header>

          <main className="thin-scroll page-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 sm:px-6">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
