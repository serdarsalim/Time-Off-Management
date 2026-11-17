"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, TypeDot, Empty } from "@/components/ui";
import { YearGrid } from "@/components/YearGrid";
import { CalendarLegend } from "@/components/CalendarLegend";
import {
  useImpersonatedUserId,
  useEffectiveRole,
} from "@/lib/impersonation";

function monthMatrix(year: number, month: number) {
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

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const now = new Date();
  const [view, setView] = useState<"month" | "year">("month");
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const [country, setCountry] = useState(""); // "" = all countries
  const [q, setQ] = useState(""); // person-name filter from the header search

  // Everyone can see the team calendar. Approvers get the full-detail feed
  // (leave type + note); everyone else gets the privacy-narrowed one, which
  // withholds the note. Acting as someone follows THEIR role, so you preview
  // exactly the feed they'd get.
  const impersonatedId = useImpersonatedUserId();
  const asUserId = impersonatedId ?? undefined;
  const role = useEffectiveRole();
  const isApprover =
    role === "admin" || role === "superadmin" || role === "office_manager";

  const fromDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const toDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  ).padStart(2, "0")}`;

  const leaveFull = useQuery(
    api.leave.calendar,
    isApprover ? { fromDate, toDate, asUserId } : "skip",
  );
  const leavePublic = useQuery(
    api.leave.calendarPublic,
    isApprover ? "skip" : { fromDate, toDate, asUserId },
  );
  const leave = isApprover ? leaveFull : leavePublic;
  const holidayRows = useQuery(api.holidays.inRangeAll, { fromDate, toDate });
  const countries = useQuery(api.countries.list);
  const workDays = useQuery(api.countries.workDaysForMe, { asUserId });
  // Weekend shading follows the filtered country's work week, else the viewer's.
  const selectedWorkDays = country
    ? countries?.find((c) => c.code === country)?.workDays
    : undefined;
  const workSet = useMemo(
    () =>
      new Set(
        selectedWorkDays && selectedWorkDays.length > 0
          ? selectedWorkDays
          : (workDays ?? [1, 2, 3, 4, 5]),
      ),
    [selectedWorkDays, workDays],
  );
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);
  const todayISO = now.toISOString().slice(0, 10);

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidayRows ?? []) {
      if (country && h.country !== country) continue;
      const existing = map.get(h.date);
      // Drop the country suffix when we're already filtered to one country.
      const label = country ? h.name : `${h.name} (${h.country})`;
      map.set(h.date, existing ? `${existing}, ${label}` : label);
    }
    return map;
  }, [holidayRows, country]);

  const byDay = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        color: string;
        type: string;
        userId?: string;
        canOpen?: boolean;
      }[]
    >();
    const needle = q.trim().toLowerCase();
    for (const r of leave ?? []) {
      if (country && r.employeeCountry !== country) continue;
      if (needle && !r.employeeName.toLowerCase().includes(needle)) continue;
      // Only the approver feed carries userId; the public one is anonymised.
      const userId = "userId" in r ? (r.userId as string) : undefined;
      // …and says whether this viewer may open that person's record.
      const canOpen = "canOpen" in r ? (r.canOpen as boolean) : false;
      for (const cell of weeks.flat()) {
        if (!cell) continue;
        if (cell >= r.startDate && cell <= r.endDate) {
          const list = map.get(cell) ?? [];
          list.push({
            name: r.employeeName,
            color: r.leaveTypeColor,
            type: r.leaveTypeName,
            userId,
            canOpen,
          });
          map.set(cell, list);
        }
      }
    }
    return map;
  }, [leave, weeks, country, q]);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    setMonth(m);
    setYear(y);
  }

  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <AppShell
      search={{ value: q, onChange: setQ }}
      title="Team Calendar"
    >
      {/* Country sits left, the period controls right. With the title hoisted
          into the navbar there was nothing anchoring the left edge and the whole
          row bunched against the right. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="Filter by country"
          className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground"
        >
          <option value="">All countries</option>
          {(countries ?? []).map((c) => (
            <option key={c._id} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-3">
          {/* Month / Year toggle */}
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {(["month", "year"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-3 py-1 text-sm font-medium capitalize transition-colors ${
                  view === v
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {/* Period nav — fixed width so it never shifts between views */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => (view === "month" ? shift(-1) : setYear(year - 1))}
              aria-label="Previous"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="w-32 text-center text-sm font-medium text-foreground">
              {view === "month" ? label : year}
            </span>
            <button
              onClick={() => (view === "month" ? shift(1) : setYear(year + 1))}
              aria-label="Next"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {view === "year" && (
        <YearGrid
          year={year}
          country={country}
          nameFilter={q}
          publicView={!isApprover}
          asUserId={asUserId}
          onSelectMonth={(m) => {
            setMonth(m);
            setView("month");
          }}
        />
      )}

      {view === "month" && (
        <>
      <Card className="p-3">
        <div className="mb-1 grid grid-cols-7 gap-1">
          {DOW.map((d) => (
            <div
              key={d}
              className="px-2 py-1 text-center text-xs font-medium text-muted"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((cell, i) => {
            if (!cell) return <div key={i} className="min-h-20" />;
            const people = byDay.get(cell) ?? [];
            const dayNum = Number(cell.slice(8));
            const isToday = cell === todayISO;
            const holiday = holidayByDate.get(cell);
            const dow = new Date(cell + "T00:00:00Z").getUTCDay();
            const nonWorking = !workSet.has(dow);
            return (
              <div
                key={i}
                className={`min-h-20 rounded-md border p-1.5 ${
                  isToday
                    ? "border-accent bg-accent-soft"
                    : holiday
                      ? "border-amber-500/30 bg-amber-500/10"
                      : nonWorking
                        ? "border-border bg-muted-bg"
                        : "border-border bg-card"
                }`}
              >
                <div
                  className={`mb-1 text-xs font-medium ${
                    isToday ? "text-accent" : "text-muted"
                  }`}
                >
                  {dayNum}
                </div>
                {holiday && (
                  <div
                    className="mb-0.5 truncate text-[10px] font-medium text-amber-700 dark:text-amber-400"
                    title={holiday}
                  >
                    {holiday}
                  </div>
                )}
                <div className="space-y-0.5">
                  {people.slice(0, 3).map((p, j) => {
                    const rowCls =
                      "flex items-center gap-1 truncate text-[11px] text-foreground/80";
                    const inner = (
                      <>
                        <TypeDot color={p.color} />
                        <span className="truncate">
                          {p.name.split(" ")[0]}
                        </span>
                      </>
                    );
                    // Only a name you can actually open becomes a link.
                    return isApprover && p.userId && p.canOpen ? (
                      <Link
                        key={j}
                        href={`/employees/${p.userId}?from=calendar`}
                        title={`${p.name} · ${p.type}`}
                        className={`${rowCls} hover:text-accent hover:underline`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div
                        key={j}
                        className={rowCls}
                        title={`${p.name} · ${p.type}`}
                      >
                        {inner}
                      </div>
                    );
                  })}
                  {people.length > 3 && (
                    <div className="text-[11px] text-muted">
                      +{people.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <CalendarLegend />

      {leave && leave.length === 0 && (
        <div className="mt-4">
          <Empty>No approved leave this month.</Empty>
        </div>
      )}
        </>
      )}
    </AppShell>
  );
}
