"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  THEME_KEY,
  type ThemeMode,
  applyDark,
  nextAutoFlip,
  persistMode,
  readMode,
  resolveDark,
} from "./theme";

// Shared theme controller. The state lives in module scope, not in the hook:
// several components render a theme control (header toggle, user menu), and
// when each held its own copy the stale one's "auto" timer would fire later,
// re-apply dark, and persist "auto" straight over an explicit light/dark
// choice. One store means one mode and one sun timer, whoever renders it.

type Snapshot = { mode: ThemeMode; dark: boolean };

const SERVER_SNAPSHOT: Snapshot = { mode: "auto", dark: false };

let snapshot: Snapshot = SERVER_SNAPSHOT;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Apply the current mode, persist it, and in "auto" schedule a single timer
// that fires exactly at the next sunrise or sunset to flip the theme.
function sync() {
  if (timer) clearTimeout(timer);
  timer = null;

  const dark = resolveDark(snapshot.mode);
  applyDark(dark);
  persistMode(snapshot.mode, dark);
  if (dark !== snapshot.dark) {
    snapshot = { ...snapshot, dark };
    emit();
  }

  if (snapshot.mode === "auto") {
    const flip = nextAutoFlip();
    // Re-sync at the next sun event (cap the delay so a stale tab still
    // recovers, and add a second so we're safely past the boundary).
    const ms = flip
      ? Math.min(Math.max(flip.getTime() - Date.now() + 1000, 1000), 6 * 60 * 60 * 1000)
      : 60 * 60 * 1000;
    timer = setTimeout(sync, ms);
  }
}

function setModeInternal(mode: ThemeMode) {
  if (mode === snapshot.mode) return;
  snapshot = { ...snapshot, mode };
  emit();
  sync();
}

function start() {
  if (started) return;
  started = true;

  snapshot = { ...snapshot, mode: readMode() };
  sync();

  // Another tab changing the theme writes localStorage; without this, our
  // "auto" timer would later persist right back over that tab's choice.
  try {
    window.addEventListener("storage", (e) => {
      if (e.key !== THEME_KEY) return;
      const mode = readMode();
      if (mode !== snapshot.mode) {
        snapshot = { ...snapshot, mode };
        emit();
        sync();
      }
    });
  } catch {}
}

export function useTheme() {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    start();
    return () => {
      listeners.delete(cb);
    };
  }, []);
  const snap = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
  const setMode = useCallback((m: ThemeMode) => setModeInternal(m), []);

  return { mode: snap.mode, dark: snap.dark, setMode };
}
