"use client";

import { useEffect, useRef, useState } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Years shown at once in the year panel — a 3×4 grid, same shape as the months.
const YEAR_PAGE = 12;
const yearPageFor = (y: number) => Math.floor(y / YEAR_PAGE) * YEAR_PAGE;

// Parse an ISO yyyy-mm-dd into its parts without going through Date(), so we
// never pick up a timezone shift (a UTC-parsed "2026-06-09" can render as the
// 8th in negative offsets).
function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const { y, m, d } = { y: +match[1], m: +match[2] - 1, d: +match[3] };
  if (m > 11 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysIn(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

export function formatDisplay(iso: string): string {
  const p = parseISO(iso);
  if (!p) return "";
  return `${MONTHS[p.m].slice(0, 3)} ${p.d}, ${p.y}`;
}

function todayISO(): string {
  const t = new Date();
  return toISO(t.getFullYear(), t.getMonth(), t.getDate());
}

// Two-digit years land in the current century — nobody types "26" meaning 1926.
function expandYear(n: number): number {
  if (n >= 1000) return n;
  return n < 100 ? 2000 + n : n;
}

function monthFromName(word: string): number | null {
  const w = word.toLowerCase();
  const i = MONTHS.findIndex(
    (m) => m.toLowerCase() === w || m.slice(0, 3).toLowerCase() === w,
  );
  return i === -1 ? null : i;
}

// Accepts what people actually type: 2026-03-03, 3/3/2026, 3.3.26, "3 Mar 2026",
// "Mar 3, 2026", "3 March" (year filled from the month currently on screen), and
// today/tomorrow/yesterday. Day-first for slash/dot forms — this app runs on
// Irish and Turkish calendars, where 3/4 means the 3rd of April.
function parseTyped(raw: string, fallbackYear: number): string | null {
  const s = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;

  if (s === "today") return todayISO();
  if (s === "tomorrow" || s === "yesterday") {
    const t = new Date();
    t.setDate(t.getDate() + (s === "tomorrow" ? 1 : -1));
    return toISO(t.getFullYear(), t.getMonth(), t.getDate());
  }

  // 2026-03-03 (also tolerates 2026/3/3)
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validate(+m[1], +m[2] - 1, +m[3]);

  // 3/3/2026, 3-3-26, 3.3.2026
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return validate(expandYear(+m[3]), +m[2] - 1, +m[1]);

  // 3/3 — year comes from the month on screen
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validate(fallbackYear, +m[2] - 1, +m[1]);

  // 3 mar 2026 / 3 march
  m = /^(\d{1,2}) ([a-zçğıöşü]+)(?: (\d{2}|\d{4}))?$/.exec(s);
  if (m) {
    const mo = monthFromName(m[2]);
    if (mo !== null) {
      return validate(m[3] ? expandYear(+m[3]) : fallbackYear, mo, +m[1]);
    }
  }

  // mar 3 2026 / march 3
  m = /^([a-zçğıöşü]+) (\d{1,2})(?: (\d{2}|\d{4}))?$/.exec(s);
  if (m) {
    const mo = monthFromName(m[1]);
    if (mo !== null) {
      return validate(m[3] ? expandYear(+m[3]) : fallbackYear, mo, +m[2]);
    }
  }

  // 03032026 / 030326
  m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(s);
  if (m) return validate(expandYear(+m[3]), +m[2] - 1, +m[1]);

  return null;
}

function validate(y: number, m: number, d: number): string | null {
  if (m < 0 || m > 11 || d < 1) return null;
  if (y < 1000 || y > 9999) return null;
  if (d > daysIn(y, m)) return null;
  return toISO(y, m, d);
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select a date",
  min,
  max,
  className = "",
  autoFocus,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  min?: string; // ISO yyyy-mm-dd — earlier dates are disabled
  max?: string; // ISO yyyy-mm-dd — later dates are disabled
  className?: string;
  autoFocus?: boolean;
  // Fired once the user settles on a date (picks a day, hits Enter, clicks
  // away). Inline editors use this to close and persist; onCancel is Escape.
  onCommit?: (iso: string) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseISO(value);
  const today = new Date();

  // While the field has focus the user's raw keystrokes win; the rest of the
  // time we mirror the committed value back as the pretty display string.
  const [typed, setTyped] = useState<string | null>(null);
  const [viewY, setViewY] = useState(parsed?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(parsed?.m ?? today.getMonth());
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [yearPage, setYearPage] = useState(
    yearPageFor(parsed?.y ?? today.getFullYear()),
  );

  // Re-center the grid on the selected month whenever the picker opens.
  useEffect(() => {
    if (!open) return;
    setView("days");
    const p = parseISO(value);
    if (p) {
      setViewY(p.y);
      setViewM(p.m);
      setYearPage(yearPageFor(p.y));
    }
  }, [open, value]);

  // Kept in a ref so the click-away listener isn't torn down and re-added on
  // every render just because the parent passed a fresh inline callback.
  const settle = useRef<{ value: string; onCommit?: (iso: string) => void }>({
    value,
    onCommit,
  });
  settle.current = { value, onCommit };

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setTyped(null);
        settle.current.onCommit?.(settle.current.value);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function shiftMonth(delta: number) {
    let m = viewM + delta;
    let y = viewY;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewM(m);
    setViewY(y);
  }

  // Drilling up through day → month → year keeps the jump inside the popover.
  // A native <select> of sixty years opens a menu taller than the screen.
  function stepView(delta: number) {
    if (view === "days") shiftMonth(delta);
    else if (view === "months") setViewY(viewY + delta);
    else setYearPage(yearPage + delta * YEAR_PAGE);
  }

  const headerLabel =
    view === "days"
      ? `${MONTHS[viewM]} ${viewY}`
      : view === "months"
        ? String(viewY)
        : `${yearPage} – ${yearPage + YEAR_PAGE - 1}`;

  const outOfRange = (iso: string) =>
    (!!min && iso < min) || (!!max && iso > max);

  function commit(iso: string) {
    if (outOfRange(iso)) return;
    onChange(iso);
    const p = parseISO(iso);
    if (p) {
      setViewY(p.y);
      setViewM(p.m);
    }
  }

  function handleTyped(raw: string) {
    setTyped(raw);
    const iso = parseTyped(raw, viewY);
    if (iso) commit(iso);
  }

  const typedISO = typed === null ? null : parseTyped(typed, viewY);
  const invalid =
    typed !== null &&
    typed.trim() !== "" &&
    (typedISO === null || outOfRange(typedISO));

  const firstDow = new Date(viewY, viewM, 1).getDay();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysIn(viewY, viewM) }, (_, i) => i + 1),
  ];

  const isToday = (d: number) =>
    today.getFullYear() === viewY &&
    today.getMonth() === viewM &&
    today.getDate() === d;
  const isSelected = (d: number) =>
    parsed?.y === viewY && parsed?.m === viewM && parsed?.d === d;

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div
        className={`flex w-full items-center rounded-md border bg-background transition-colors focus-within:border-foreground ${
          invalid ? "border-red-500/60" : "border-border"
        }`}
      >
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={typed ?? (value ? formatDisplay(value) : "")}
          placeholder={placeholder}
          onFocus={(e) => {
            setOpen(true);
            e.currentTarget.select();
          }}
          onChange={(e) => handleTyped(e.target.value)}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setTyped(null);
              setOpen(false);
              onCommit?.(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              // Swallow it while the calendar is up, otherwise Escape would
              // also close the dialog the picker is sitting in.
              if (open) e.stopPropagation();
              setTyped(null);
              setOpen(false);
              onCancel?.();
            } else if (e.key === "ArrowDown" && !open) {
              setOpen(true);
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open calendar"
          onClick={() => {
            setOpen(true);
            inputRef.current?.focus();
          }}
          className="shrink-0 rounded-r-md px-2.5 py-2 text-muted transition-colors hover:text-foreground"
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepView(-1)}
              aria-label="Previous"
              className="rounded-md p-1 text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => {
                if (view === "days") setView("months");
                else if (view === "months") {
                  setYearPage(yearPageFor(viewY));
                  setView("years");
                } else setView("days");
              }}
              className="flex-1 rounded-md py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg"
            >
              {headerLabel}
            </button>

            <button
              type="button"
              onClick={() => stepView(1)}
              aria-label="Next"
              className="rounded-md p-1 text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {view === "months" && (
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setViewM(i);
                    setView("days");
                  }}
                  className={`rounded-md py-2 text-sm transition-colors ${
                    i === viewM
                      ? "bg-accent font-semibold text-accent-fg"
                      : "text-foreground hover:bg-muted-bg"
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {view === "years" && (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: YEAR_PAGE }, (_, i) => yearPage + i).map(
                (y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setViewY(y);
                      setView("months");
                    }}
                    className={`rounded-md py-2 text-sm transition-colors ${
                      y === viewY
                        ? "bg-accent font-semibold text-accent-fg"
                        : "text-foreground hover:bg-muted-bg"
                    }`}
                  >
                    {y}
                  </button>
                ),
              )}
            </div>
          )}

          {view === "days" && (
          <>
          <div className="mb-1 grid grid-cols-7 gap-1">
            {DOW.map((d) => (
              <span key={d} className="text-center text-[10px] font-medium text-muted">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) =>
              d === null ? (
                <span key={`pad-${i}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  disabled={outOfRange(toISO(viewY, viewM, d))}
                  onClick={() => {
                    const iso = toISO(viewY, viewM, d);
                    commit(iso);
                    setTyped(null);
                    setOpen(false);
                    onCommit?.(iso);
                  }}
                  className={`flex h-8 items-center justify-center rounded-md text-sm transition-colors ${
                    outOfRange(toISO(viewY, viewM, d))
                      ? "cursor-not-allowed text-muted/40"
                      : isSelected(d)
                        ? "bg-accent font-semibold text-accent-fg"
                        : isToday(d)
                          ? "text-accent ring-1 ring-inset ring-accent/40 hover:bg-muted-bg"
                          : "text-foreground hover:bg-muted-bg"
                  }`}
                >
                  {d}
                </button>
              ),
            )}
          </div>
          </>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-[11px] text-muted">
              Type a date, e.g. 3/4/2026
            </span>
            <button
              type="button"
              disabled={outOfRange(todayISO())}
              onClick={() => {
                commit(todayISO());
                setTyped(null);
                setOpen(false);
                onCommit?.(todayISO());
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-muted-bg disabled:cursor-not-allowed disabled:text-muted/40 disabled:hover:bg-transparent"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
