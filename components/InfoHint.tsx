"use client";

import { ReactNode } from "react";

// Small (i) icon that reveals an explanation on hover/focus. Use this instead
// of a sentence/paragraph of helper text under a heading — keep the UI terse
// and tuck the detail behind the icon.
export function InfoHint({
  children,
  width = "w-60",
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label="More information"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted transition-colors hover:border-foreground hover:text-foreground"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 ${width} -translate-x-1/2 rounded-md border border-border bg-card p-2.5 text-xs font-normal normal-case leading-relaxed text-muted opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100`}
      >
        {children}
      </span>
    </span>
  );
}
