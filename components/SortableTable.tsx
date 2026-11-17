"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Shared client-side sorting + filter-select primitives for the app's tables.
// Sorting is per-table local state (no URL/persistence — these lists are small
// and live-updating via Convex, so a stable comparator over the query result
// is all that's needed).

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir };

type SortValue = string | number | boolean | null | undefined;
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

export function useSortedRows<T>(
  rows: T[],
  accessors: SortAccessors<T>,
  initial: SortState,
) {
  const [sort, setSort] = useState<SortState>(initial);

  function toggle(key: string) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  // Explicit direction, for menus that offer A→Z / Z→A as separate choices.
  function sortBy(key: string, dir: SortDir) {
    setSort({ key, dir });
  }

  const sorted = useMemo(() => {
    const get = accessors[sort.key];
    if (!get) return rows;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Empty values sink to the bottom regardless of direction.
      const ea = va === null || va === undefined || va === "";
      const eb = vb === null || vb === undefined || vb === "";
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * mul;
      }
      return (
        String(va).localeCompare(String(vb), undefined, {
          sensitivity: "base",
          numeric: true,
        }) * mul
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sorted, sort, toggle, sortBy };
}

// Clickable column header. Use inside the existing <tr> header rows; keeps the
// same typography as the plain <th> cells so mixed sortable/static columns line
// up.
export function SortableTh({
  label,
  sortKey,
  sort,
  onToggle,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onToggle: (key: string) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const isActive = sort.key === sortKey;
  return (
    <th
      aria-sort={
        isActive ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={`px-4 pt-3.5 pb-2.5 font-semibold ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`group inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : ""
        }`}
      >
        {label}
        <span
          aria-hidden
          className={`text-[9px] leading-none transition-opacity ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40"
          }`}
        >
          {isActive && sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" aria-hidden
      fill={active ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden
      stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// Column header that owns both sorting and filtering: click the label to sort,
// or open the funnel for explicit sort direction plus the column's filter.
// The menu renders in a portal because the table's card scrolls horizontally,
// and an absolutely-positioned menu inside it would be clipped.
export function FilterableTh({
  label,
  sortKey,
  sort,
  onToggle,
  onSort,
  filter,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey?: string;
  sort?: SortState;
  onToggle?: (key: string) => void;
  onSort?: (key: string, dir: SortDir) => void;
  filter?: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  };
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const sortable = !!sortKey && !!sort;
  const isSorted = sortable && sort!.key === sortKey;
  const filtered = !!filter && filter.value !== "";

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // The anchor moves with the page, so close rather than chase it.
    function dismiss() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 224; // w-56
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
    setOpen(true);
  }

  const rowCls =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted-bg";

  return (
    <th
      aria-sort={
        isSorted ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={`px-4 pt-3.5 pb-2.5 font-semibold ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {sortable ? (
          <button
            type="button"
            onClick={() => onToggle?.(sortKey!)}
            className={`group inline-flex items-center gap-1 transition-colors hover:text-foreground ${
              isSorted ? "text-foreground" : ""
            }`}
          >
            {label}
            <span
              aria-hidden
              className={`text-[9px] leading-none transition-opacity ${
                isSorted ? "opacity-100" : "opacity-0 group-hover:opacity-40"
              }`}
            >
              {isSorted && sort!.dir === "desc" ? "▼" : "▲"}
            </span>
          </button>
        ) : (
          <span className={filtered ? "text-foreground" : ""}>{label}</span>
        )}

        {filter && (
          <button
            ref={btnRef}
            type="button"
            onClick={() => (open ? setOpen(false) : openMenu())}
            aria-label={`Filter and sort by ${label}`}
            aria-expanded={open}
            title={`Filter ${label}`}
            className={`rounded p-0.5 transition-all ${
              filtered
                ? "text-accent opacity-100"
                : "text-muted opacity-0 hover:text-foreground focus:opacity-100 group-hover/head:opacity-60"
            } ${open ? "!opacity-100 text-foreground" : ""}`}
          >
            <FunnelIcon active={filtered} />
          </button>
        )}
      </span>

      {open &&
        filter &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 text-sm font-normal normal-case shadow-lg"
          >
            {sortable && onSort && (
              <>
                {(
                  [
                    ["asc", "Sort A → Z"],
                    ["desc", "Sort Z → A"],
                  ] as const
                ).map(([dir, text]) => (
                  <button
                    key={dir}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSort(sortKey!, dir);
                      setOpen(false);
                    }}
                    className={rowCls}
                  >
                    <span className="inline-flex w-3.5 justify-center text-accent">
                      {isSorted && sort!.dir === dir ? <CheckIcon /> : null}
                    </span>
                    {text}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
              </>
            )}
            <div className="max-h-64 overflow-y-auto">
              {filter.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter.value === o.value}
                  onClick={() => {
                    filter.onChange(o.value);
                    setOpen(false);
                  }}
                  className={rowCls}
                >
                  <span className="inline-flex w-3.5 shrink-0 justify-center text-accent">
                    {filter.value === o.value ? <CheckIcon /> : null}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </th>
  );
}

// Compact labelled <select> used in table filter bars.
export function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-foreground"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
