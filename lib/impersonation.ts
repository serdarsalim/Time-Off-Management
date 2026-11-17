"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const KEY = "timeoff.impersonate.userId";
// Where "Act as" was triggered from, so Exit can return there.
const RETURN_KEY = "timeoff.impersonate.returnTo";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (typeof window !== "undefined") window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined")
      window.removeEventListener("storage", cb);
  };
}

function read(): Id<"users"> | null {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem(KEY) as Id<"users"> | null) ?? null;
}

export function startImpersonation(userId: Id<"users">) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, userId);
  // Capture the page we're on now (before the caller redirects) so Exit can
  // bring us back to exactly where "Act as" was clicked.
  localStorage.setItem(
    RETURN_KEY,
    window.location.pathname + window.location.search,
  );
  emit();
}

// The path where impersonation started, or null. Read this before
// stopImpersonation (which clears it) to navigate back.
export function getReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(RETURN_KEY);
}

export function stopImpersonation() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  localStorage.removeItem(RETURN_KEY);
  emit();
}

// Reactive read of the currently-impersonated userId (null when not acting as
// anyone). Syncs across tabs via the storage event.
export function useImpersonatedUserId(): Id<"users"> | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

// The role every screen should reflect: the impersonated person's while acting
// as someone, else your own. Acting as a user means seeing their app, so page
// gates read this rather than the real caller's role — otherwise a page would
// render for you and then throw when its query resolves as them. Returns
// undefined while loading, so callers can hold rather than flash the wrong UI.
export function useEffectiveRole(): string | undefined {
  const me = useQuery(api.users.me);
  const impersonatedId = useImpersonatedUserId();
  const actingAs = useQuery(
    api.users.getById,
    impersonatedId ? { userId: impersonatedId } : "skip",
  );
  if (impersonatedId) {
    return actingAs === undefined ? undefined : (actingAs?.role ?? undefined);
  }
  return me === undefined ? undefined : (me?.role ?? undefined);
}
