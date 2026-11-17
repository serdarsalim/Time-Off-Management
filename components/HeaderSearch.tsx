"use client";

// Persistent header search: compact at rest, growing with what you TYPE —
// never on focus alone.
//
// It used to size against the placeholder too, which defeated the point. A
// descriptive placeholder like "Search name, title, office…" pinned the box to
// its 16rem maximum before anyone touched it, so it never looked compact and
// never appeared to grow. The resting size is now fixed and only the query
// moves it; keep placeholders to the single word.
export function HeaderSearch({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 24 24" width="15" height="15" fill="none"
        stroke="currentColor" strokeWidth="2"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        // 3.5rem covers the icon inset + right padding; clamp holds it at 7rem
        // until the query outgrows that, then lets it run to 16rem.
        style={{ width: `clamp(7rem, ${value.length}ch + 3.5rem, 16rem)` }}
        className="rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-foreground outline-none transition-[width,border-color] duration-200 focus:border-foreground"
      />
    </div>
  );
}
