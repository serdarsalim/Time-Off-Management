"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CalendarLegend } from "./CalendarLegend";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function monthMatrix(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: string[] = [];
  for (let i = 0; i < startDow; i++) cells.push("");
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push("");
  const weeks: string[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function YearGrid({
  year,
  country = "",
  nameFilter = "",
  publicView = false,
  asUserId,
  onSelectMonth,
}: {
  year: number;
  country?: string;
  // Person-name filter from the header search; substring, case-insensitive.
  nameFilter?: string;
  publicView?: boolean;
  // Set while acting as someone, so the grid shows their feed.
  asUserId?: string;
  // Drill-in: click a month heading to open that month's detailed view.
  onSelectMonth?: (month: number) => void;
}) {
  const range = { fromDate: `${year}-01-01`, toDate: `${year}-12-31` };
  const leaveFull = useQuery(
    api.leave.calendar,
    publicView ? "skip" : { ...range, asUserId: asUserId as any },
  );
  const leavePublic = useQuery(
    api.leave.calendarPublic,
    publicView ? { ...range, asUserId: asUserId as any } : "skip",
  );
  const leave = publicView ? leavePublic : leaveFull;
  const holidays = useQuery(api.holidays.inRangeAll, {
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
  });

  // date -> people off that day
  const byDate = useMemo(() => {
    const map = new Map<string, { name: string; color: string; type: string }[]>();
    const needle = nameFilter.trim().toLowerCase();
    for (const r of leave ?? []) {
      if (country && r.employeeCountry !== country) continue;
      if (needle && !r.employeeName.toLowerCase().includes(needle)) continue;
      const start = new Date(r.startDate + "T00:00:00Z");
      const end = new Date(r.endDate + "T00:00:00Z");
      const cursor = new Date(start);
      while (cursor <= end) {
        const iso = cursor.toISOString().slice(0, 10);
        const list = map.get(iso) ?? [];
        list.push({
          name: r.employeeName,
          color: r.leaveTypeColor,
          type: r.leaveTypeName,
        });
        map.set(iso, list);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return map;
  }, [leave, country, nameFilter]);

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays ?? []) {
      if (country && h.country !== country) continue;
      const label = country ? h.name : `${h.name} (${h.country})`;
      const existing = map.get(h.date);
      map.set(h.date, existing ? `${existing}, ${label}` : label);
    }
    return map;
  }, [holidays, country]);

  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MONTHS.map((label, m) => {
          const weeks = monthMatrix(year, m);
          return (
            <div
              key={label}
              className="card p-3"
            >
              <button
                type="button"
                onClick={() => onSelectMonth?.(m)}
                title={`View ${label} ${year}`}
                className="mb-2 text-sm font-semibold text-foreground underline decoration-border decoration-1 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
              >
                {label}
              </button>
              <div className="mb-1 grid grid-cols-7 gap-0.5">
                {DOW.map((d, i) => (
                  <div
                    key={i}
                    className="text-center text-[10px] font-medium text-muted"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {weeks.flat().map((cell, i) => {
                  if (!cell) return <div key={i} className="h-7" />;
                  const day = Number(cell.slice(8));
                  const people = byDate.get(cell) ?? [];
                  const holiday = holidayByDate.get(cell);
                  const isToday = cell === todayISO;
                  const title = [
                    holiday,
                    ...people.map((p) => `${p.name} (${p.type})`),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div
                      key={i}
                      title={title || undefined}
                      className={`flex h-7 flex-col items-center justify-center rounded ${
                        isToday
                          ? "bg-accent text-accent-fg"
                          : holiday
                            ? "bg-amber-500/15"
                            : people.length
                              ? "bg-accent-soft"
                              : ""
                      }`}
                    >
                      <span
                        className={`text-[10px] leading-none ${
                          isToday
                            ? "font-semibold"
                            : holiday
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-foreground"
                        }`}
                      >
                        {day}
                      </span>
                      {people.length > 0 && !isToday && (
                        <span className="mt-0.5 flex gap-0.5">
                          {people.slice(0, 3).map((p, j) => (
                            <span
                              key={j}
                              className="h-1 w-1 rounded-full"
                              style={{ backgroundColor: p.color }}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <CalendarLegend />
    </div>
  );
}
