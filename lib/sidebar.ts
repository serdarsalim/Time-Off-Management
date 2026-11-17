"use client";

import { useSyncExternalStore } from "react";

const KEY = "timeoff.sidebar.collapsed";

// Every page renders its own AppShell, so navigating remounts it. Reading the
// preference in an effect therefore replayed "expanded → collapsed" on each
// navigation. Caching it at module scope means a remount already knows the
// answer on its first render, so there's nothing to correct.
let cached: boolean | null = null;
let settled = false;
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  if (cached === null) {
    try {
      cached = localStorage.getItem(KEY) === "1";
    } catch {
      cached = false;
    }
  }
  return cached;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function setSidebarCollapsed(next: boolean) {
  cached = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}

// True once the stored value has been applied at least once this session. The
// width transition is held back until then, so the one unavoidable correction
// after a hard refresh snaps instead of animating.
export function sidebarSettled(): boolean {
  return settled;
}

export function markSidebarSettled() {
  settled = true;
}
