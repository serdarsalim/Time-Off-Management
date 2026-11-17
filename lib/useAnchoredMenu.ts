"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// useLayoutEffect warns when React renders on the server. The menu is never
// open during SSR, so the effect would no-op anyway — this just keeps the
// warning out of the console.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Anchored floating menus — dropdowns, popovers, row menus — MUST render in a
// portal at fixed coordinates. This hook is the only correct way to do it here.
//
// Why it can't be `absolute` + `z-50`: almost every menu in this app opens
// inside a table or card wrapped in `overflow-hidden`, and an overflow clip
// traps absolutely-positioned descendants no matter how high their z-index is.
// The menu doesn't render "behind" anything — it's cut off at the ancestor's
// edge. Raising z-index cannot fix it; only escaping the clipping ancestor can,
// which means a portal to document.body.
//
// It also survives the second failure: a menu that stays put while the page
// scrolls under it. `place` re-runs on scroll (capture: true, so it catches
// scrolling containers, not just the window) and on resize.
//
// Usage:
//   const { open, setOpen, anchorRef, menuRef, pos } = useAnchoredMenu();
//   <button ref={anchorRef} onClick={() => setOpen(v => !v)}>…</button>
//   {open && pos && createPortal(
//     <div ref={menuRef} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}>…</div>,
//     document.body,
//   )}

export type MenuPos = { top: number; left: number; width: number };

export function useAnchoredMenu<A extends HTMLElement = HTMLButtonElement>(opts?: {
  // Fixed menu width in px. Omit to match the anchor's width — the right
  // default for a select-like control, where a menu narrower or wider than its
  // trigger reads as a different control.
  width?: number;
  // Minimum width when matching the anchor: a borderless inline cell can be
  // very narrow, and a 60px dropdown of city names is unusable.
  minWidth?: number;
  // Which side of the anchor the menu opens on. "below" (default) is what
  // every dropdown wants. "above" is for anchors pinned to the bottom of a
  // pane — the sidebar's account button — where a downward menu would open
  // straight off the bottom of the screen.
  //
  // "above" needs the menu's measured HEIGHT, which doesn't exist until it has
  // rendered. So the first paint places it optimistically off the anchor's top
  // edge and a layout effect corrects it once the node is measurable. Callers
  // get `ready`: false for that one frame, to keep the correction invisible.
  placement?: "above" | "below";
}): {
  open: boolean;
  setOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  anchorRef: RefObject<A | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  pos: MenuPos | null;
  // False only on the first frame of an "above" menu, before its height is
  // measurable. Render the portal but keep it invisible until this is true.
  // Always true for "below", which needs no measurement.
  ready: boolean;
} {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [ready, setReady] = useState(false);
  const anchorRef = useRef<A | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const width = opts?.width;
  const minWidth = opts?.minWidth ?? 0;
  const placement = opts?.placement ?? "below";

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.max(width ?? r.width, minWidth);
      // Flip to the anchor's right edge rather than run off the viewport.
      let left = r.left;
      if (left + w > window.innerWidth - 8) left = Math.max(8, r.right - w);
      const h = menuRef.current?.offsetHeight ?? 0;
      if (placement === "above") {
        // Clamp to the viewport top the same way `left` clamps to its edge: a
        // menu taller than the space above its anchor should be fully visible
        // rather than half off-screen.
        setPos({ top: Math.max(8, r.top - 4 - h), left, width: w });
        if (h > 0) setReady(true);
        return;
      }
      // "below" FLIPS above when the measured menu doesn't fit under the
      // anchor but does fit over it — an anchor near the viewport bottom
      // otherwise opens its menu straight off the screen. First paint (h=0,
      // not yet measurable) places below; the layout effect under this one
      // re-places as soon as the height exists.
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const top =
        h > 0 && h > spaceBelow && r.top - 8 > h ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
      setPos({ top, left, width: w });
      setReady(true);
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    // capture: true — scroll events from a scrolling CONTAINER (the app shell's
    // main pane, a table body) don't bubble to window; capture sees them.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, width, minWidth, placement]);

  // The post-commit measurement, run once the portal is actually in the DOM.
  // It finishes "above" placement (which cannot position without a height)
  // and applies the "below" flip (which cannot DECIDE without one).
  //
  // This used to be a requestAnimationFrame scheduled next to the placement
  // above, and that was a race it could lose: rAF fires before the next paint,
  // but NOT necessarily after React has committed the portal. When it lost,
  // the height read 0, `ready` never flipped, and the menu sat invisible until
  // some later scroll or resize re-placed it — which looked exactly like the
  // click doing nothing. A fresh page load lost most often, because that's
  // when React is busiest and slowest to commit.
  //
  // A layout effect cannot lose it: React runs it after the DOM is updated. No
  // dep array on purpose — it re-runs each commit while the menu is open, so
  // the first commit that includes the portal resolves it (and a menu whose
  // CONTENT grows or shrinks while open re-decides the flip). The functional
  // setPos bails out on identical coordinates, which is what stops it from
  // looping.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    const h = menuRef.current?.offsetHeight ?? 0;
    if (!el || h === 0) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(width ?? r.width, minWidth);
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.right - w);
    let top: number;
    if (placement === "above") {
      top = Math.max(8, r.top - 4 - h);
    } else {
      const spaceBelow = window.innerHeight - r.bottom - 8;
      top = h > spaceBelow && r.top - 8 > h ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    }
    setPos((p) =>
      p && p.top === top && p.left === left && p.width === w ? p : { top, left, width: w },
    );
    if (placement === "above") setReady(true);
  });

  return { open, setOpen, anchorRef, menuRef, pos, ready };
}
