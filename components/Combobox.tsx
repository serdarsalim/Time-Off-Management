"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ComboOption = { value: string; label: string; hint?: string };

// A searchable single-select: a text input that filters the options as you
// type, styled to the app (not the native OS <select>). Keyboard: ↑/↓ to move,
// Enter to pick, Esc to close.
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [query, options]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(v: string) {
    onChange(v);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        pick(filtered[active].value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          value={open ? query : (selected?.label ?? "")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onKeyDown={onKeyDown}
          placeholder={selected ? selected.label : placeholder}
          className="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground outline-none transition-colors focus:border-foreground"
        />
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matches</li>
          ) : (
            filtered.map((o, i) => (
              <li key={o.value} data-idx={i}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    i === active ? "bg-muted-bg text-foreground" : "text-foreground"
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="shrink-0 text-[11px] text-muted">{o.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
