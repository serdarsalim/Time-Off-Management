"use client";

import { ReactNode, useEffect } from "react";

// Small accessible modal: backdrop, Escape to close, locked scroll, centered
// card. Reuse for any "input happens in a dialog" flow.
export function Modal({
  open,
  onClose,
  title,
  titleHint,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  // Sits beside the title — an InfoHint for anything that explains the dialog
  // but shouldn't be read before the controls. Kept separate from `title` so
  // the aria-label stays plain text.
  titleHint?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
            {title}
            {titleHint}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-md p-1 text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
