"use client";

import { useState } from "react";

// Six preset leave-type colors.
export const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

// A color swatch that opens a modal to pick from the preset palette.
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Choose colour"
        title="Choose colour"
        className="h-[19px] w-[19px] shrink-0 rounded-md ring-1 ring-black/10 transition hover:scale-110 dark:ring-white/15"
        style={{ backgroundColor: value }}
      />
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-sm font-semibold text-foreground">
              Choose a colour
            </div>
            <div className="flex flex-wrap gap-2.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  aria-label={c}
                  className={`h-9 w-9 rounded-md transition hover:scale-110 ${
                    value === c
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
