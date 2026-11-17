// Default work week: Mon–Fri (day indices 1–5; 0=Sun, 6=Sat). Mirrors the
// server constant in convex/model.ts.
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

// True when `dow` (0=Sun … 6=Sat) is a working weekday for the given week.
export function isWorkday(
  dow: number,
  workDays: number[] = DEFAULT_WORK_DAYS,
): boolean {
  return workDays.includes(dow);
}

// Count working days in an inclusive ISO range, excluding non-working weekdays
// (per `workDays`) and any date in `holidays`. Mirrors the server logic so the
// request form can preview the working-day total before submitting.
export function countWorkingDays(
  startISO: string,
  endISO: string,
  holidays: Set<string> = new Set(),
  workDays: number[] = DEFAULT_WORK_DAYS,
): number {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (workDays.includes(day) && !holidays.has(iso)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function isWorkingDay(
  iso: string,
  holidays: Set<string> = new Set(),
  workDays: number[] = DEFAULT_WORK_DAYS,
): boolean {
  if (!iso) return false;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return workDays.includes(day) && !holidays.has(iso);
}

// Working days for a request including half-days. Mirrors the server logic.
export function countLeaveDays(
  startISO: string,
  endISO: string,
  holidays: Set<string> = new Set(),
  startHalf = false,
  endHalf = false,
  workDays: number[] = DEFAULT_WORK_DAYS,
): number {
  const base = countWorkingDays(startISO, endISO, holidays, workDays);
  if (base === 0) return 0;
  if (startISO === endISO) {
    return startHalf && isWorkingDay(startISO, holidays, workDays) ? 0.5 : base;
  }
  let days = base;
  if (startHalf && isWorkingDay(startISO, holidays, workDays)) days -= 0.5;
  if (endHalf && isWorkingDay(endISO, holidays, workDays)) days -= 0.5;
  return days;
}

export function formatRange(startISO: string, endISO: string): string {
  if (startISO === endISO) return formatDay(startISO);
  return `${formatDay(startISO)} → ${formatDay(endISO)}`;
}

// Compact variants for dense dashboard lists: the current year goes
// unprinted — "17 Aug", not "17 Aug 2026". Any other year stays, so last
// year's stale request can't be misread as upcoming.
export function formatDayCompact(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

export function formatRangeCompact(startISO: string, endISO: string): string {
  if (startISO === endISO) return formatDayCompact(startISO);
  return `${formatDayCompact(startISO)} → ${formatDayCompact(endISO)}`;
}

// Short description of any half-days on a request, or null if it's full days.
export function halfLabel(r: {
  startHalf?: boolean;
  endHalf?: boolean;
  halfPeriod?: "morning" | "afternoon";
  startDate: string;
  endDate: string;
}): string | null {
  if (r.startDate === r.endDate) {
    if (!r.startHalf) return null;
    return r.halfPeriod ? `½ day · ${r.halfPeriod}` : "½ day";
  }
  const parts: string[] = [];
  if (r.startHalf) parts.push("first ½");
  if (r.endHalf) parts.push("last ½");
  return parts.length ? parts.join(", ") : null;
}

export function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// "90" → "1h 30m", "45" → "45m", "120" → "2h". Mirrors convex/format.ts.
export function formatLateness(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h && rem) return `${h}h ${rem}m`;
  if (h) return `${h}h`;
  return `${rem}m`;
}
