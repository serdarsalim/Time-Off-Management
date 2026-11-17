import { ConvexError } from "convex/values";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";

export async function getCurrentProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function requireProfile(ctx: QueryCtx | MutationCtx) {
  const profile = await getCurrentProfile(ctx);
  if (!profile) throw new ConvexError("Not authenticated.");
  // Offboarding revokes access. This is the caller's own profile, so it never
  // blocks an admin from viewing an offboarded person's record — only that
  // person from using the app. `users.me` deliberately skips this check so the
  // shell can render a proper "access ended" screen instead of an error.
  if (!profile.active || profile.signInBlocked) {
    throw new ConvexError("ACCESS_REVOKED");
  }
  return profile;
}

// admin and superadmin share the same management rights (settings, people,
// directory). They differ in REACH over individuals: an admin acts on the
// people they approve for, a superadmin on anyone — see canManageUser.
export function isAdmin(role: string): boolean {
  return role === "admin" || role === "superadmin";
}

// The only role with company-wide reach over individuals: sees every pending
// request, every person on the dashboard, and can act as anyone.
export function isSuperadmin(role: string): boolean {
  return role === "superadmin";
}

// Who can decide leave requests: admins (anyone's) and office managers (their
// own team only — scoping is enforced where requests are loaded).
export function canApprove(role: string): boolean {
  return isAdmin(role) || role === "office_manager";
}

export async function getProfileByUserId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// userIds of all active superadmins — the catch-all recipients for a request
// from someone with no assigned approver. Deliberately NOT every admin: an
// admin's notifications are limited to the people they approve for.
export async function getSuperadminUserIds(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">[]> {
  const all = await ctx.db.query("profiles").collect();
  return all
    .filter((p) => p.active && isSuperadmin(p.role))
    .map((p) => p.userId);
}

// Resolve which profile a personal-leave action applies to. An admin may pass
// `asUserId` to act as another user (impersonation); everyone else acts as
// themselves. Returns the effective profile plus the real caller and whether
// impersonation is in effect — so callers can scope data to the effective user
// while attributing audit entries to the real admin.
export async function resolveActingProfile(
  ctx: QueryCtx | MutationCtx,
  asUserId?: Id<"users">,
) {
  const caller = await requireProfile(ctx);
  if (asUserId && isAdmin(caller.role) && asUserId !== caller.userId) {
    const target = await getProfileByUserId(ctx, asUserId);
    if (!target) throw new ConvexError("That person does not exist.");
    if (!isSuperadmin(caller.role)) {
      // Acting as a superadmin would hand the caller the higher role, so it
      // stays superadmin-only however the teams are arranged.
      if (isSuperadmin(target.role)) {
        throw new ConvexError("You can't act as a superadmin.");
      }
      if (!(await isOnApproverTeam(ctx, caller, asUserId))) {
        throw new ConvexError("You can only act as people you approve for.");
      }
    }
    return { profile: target, caller, impersonating: true as const };
  }
  return { profile: caller, caller, impersonating: false as const };
}

// Resolve the profile a read is ABOUT: the caller, or — for admins — anyone,
// including another admin. Unlike resolveActingProfile this is not an
// impersonation gate: it only answers "whose country/config applies here?" and
// never grants the right to act as that person. Use it for the read queries
// behind admin direct entry (an admin records leave for an admin colleague);
// keep resolveActingProfile for anything that writes as the target.
export async function resolveViewedProfile(
  ctx: QueryCtx | MutationCtx,
  userId?: Id<"users">,
) {
  const caller = await requireProfile(ctx);
  if (userId && isAdmin(caller.role) && userId !== caller.userId) {
    const target = await getProfileByUserId(ctx, userId);
    if (!target) throw new ConvexError("That person does not exist.");
    return { profile: target, caller };
  }
  return { profile: caller, caller };
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const profile = await requireProfile(ctx);
  if (!isAdmin(profile.role)) throw new ConvexError("Admins only.");
  return profile;
}

// Company-level configuration — leave types, countries, holidays, calendar
// visibility — plus the company-wide activity log. Admins run their own team;
// changing the rules everyone works under is superadmin territory.
export async function requireSuperadmin(ctx: QueryCtx | MutationCtx) {
  const profile = await requireProfile(ctx);
  if (!isSuperadmin(profile.role)) throw new ConvexError("Superadmins only.");
  return profile;
}

// Whoever can act on approvals and reports: admins and superadmins.
export async function requireApprover(ctx: QueryCtx | MutationCtx) {
  return await requireAdmin(ctx);
}

// Who approves this person's leave: their direct manager, else the
// department approver. Returns the approver's userId, or null.
export async function resolveApprover(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles">,
): Promise<Id<"users"> | null> {
  if (profile.managerId) return profile.managerId;
  if (profile.departmentId) {
    const dept = await ctx.db.get(profile.departmentId);
    if (dept?.approverId) return dept.approverId;
  }
  return null;
}

// Is `targetUserId` on `approver`'s team — i.e. does this approver resolve as
// the target's approver (direct manager or department approver)?
export async function isOnApproverTeam(
  ctx: QueryCtx | MutationCtx,
  approver: Doc<"profiles">,
  targetUserId: Id<"users">,
): Promise<boolean> {
  const target = await getProfileByUserId(ctx, targetUserId);
  if (!target) return false;
  return (await resolveApprover(ctx, target)) === approver.userId;
}

// May `caller` act ON this individual — impersonate them, approve their leave,
// enter leave for them, count them in dashboard figures? Superadmins reach
// everyone; admins and office managers reach the people they approve for.
// requireTeamAccess wraps this for the read side, so acting on someone and
// reading their record resolve to the same set.
export async function canManageUser(
  ctx: QueryCtx | MutationCtx,
  caller: Doc<"profiles">,
  targetUserId: Id<"users">,
): Promise<boolean> {
  if (isSuperadmin(caller.role)) return true;
  if (!canApprove(caller.role)) return false;
  if (targetUserId === caller.userId) return true;
  return await isOnApproverTeam(ctx, caller, targetUserId);
}

// Read access to another person's record — balances, leave history, lateness,
// notes. Superadmins see anyone; admins and office managers see the people they
// approve for, and themselves. Hiding the directory tab alone wouldn't achieve
// this: the profile page is reachable by URL.
export async function requireTeamAccess(
  ctx: QueryCtx | MutationCtx,
  targetUserId: Id<"users">,
) {
  const profile = await requireProfile(ctx);
  if (await canManageUser(ctx, profile, targetUserId)) return profile;
  throw new ConvexError("Not authorized.");
}

// Default work week: Mon–Fri (day indices 1–5; 0=Sun, 6=Sat). Used when a
// country hasn't configured its own working days.
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

// Count working days between two inclusive ISO dates, excluding non-working
// weekdays (per `workDays`) and any date in `holidays`.
export function countWorkingDays(
  startISO: string,
  endISO: string,
  holidays: Set<string> = new Set(),
  workDays: number[] = DEFAULT_WORK_DAYS,
): number {
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ConvexError("Invalid date.");
  }
  if (end < start) throw new ConvexError("End date is before start date.");
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
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay();
  return workDays.includes(day) && !holidays.has(iso);
}

// Working days for a leave request, accounting for half-days. A single-day
// request with startHalf counts 0.5. A range subtracts 0.5 for each of the
// first/last day flagged as a half day (when that day is a working day).
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

// The configured work week for a country code (defaults to Mon–Fri). Empty or
// missing config falls back to the default rather than "no working days".
export async function getCountryWorkDays(
  ctx: QueryCtx | MutationCtx,
  country?: string,
): Promise<number[]> {
  const row = await ctx.db
    .query("countries")
    .withIndex("by_code", (q) => q.eq("code", countryOf(country)))
    .unique();
  return row?.workDays && row.workDays.length > 0
    ? row.workDays
    : DEFAULT_WORK_DAYS;
}

// The owners: the people who administer the deployment itself, listed by email
// in the OWNER_EMAILS environment variable (comma separated). Deliberately not
// a role in the database — the whole point is that it can't be granted from
// inside the app, only by whoever can change the deployment's environment.
// Unset means nobody qualifies, so owner-only actions fail closed.
export function isOwner(profile: { email: string }): boolean {
  const owners = (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return owners.includes(profile.email.trim().toLowerCase());
}

// userIds excluded from every shared view. The employee list deliberately
// still shows them — hiding somewhere you can't reach to undo it isn't a
// setting, it's a trapdoor.
export async function hiddenUserIds(
  ctx: QueryCtx | MutationCtx,
): Promise<Set<Id<"users">>> {
  const all = await ctx.db.query("profiles").collect();
  return new Set(
    all.filter((p) => p.hiddenFromRoster).map((p) => p.userId),
  );
}

export function countryOf(value?: string): string {
  return value ?? "IE";
}

// The one true order for leave types: the admin-set position, then creation
// time for rows that have never been dragged. Every query that hands leave
// types to the UI runs through this, so the settings order is what employees,
// the calendar key, the booking form and the admin dashboard all see.
export function sortLeaveTypes<T extends { sortOrder?: number; _creationTime: number }>(
  types: T[],
): T[] {
  return [...types].sort(
    (a, b) =>
      (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
      a._creationTime - b._creationTime,
  );
}

// Load the set of holiday dates covering the years spanned by a range, scoped
// to a single country (legacy rows with no country count as "IE").
export async function getHolidaySet(
  ctx: QueryCtx | MutationCtx,
  startISO: string,
  endISO: string,
  country: string,
): Promise<Set<string>> {
  const startYear = yearOf(startISO);
  const endYear = yearOf(endISO);
  const set = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    const rows = await ctx.db
      .query("holidays")
      .withIndex("by_year", (q) => q.eq("year", y))
      .collect();
    for (const r of rows) {
      if (countryOf(r.country) === country) set.add(r.date);
    }
  }
  return set;
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

// ── Leave periods ───────────────────────────────────────────────────────────
// A "leave period" is the window an annual entitlement covers. Ireland uses the
// calendar year (Jan–Dec). Türkiye uses the employment-anniversary year, so
// someone who started 1 Jul has periods running Jul→Jun. A period is identified
// by the calendar year it STARTS in.

// A profile enriched with its country's leave-year rule. `mode` and the tier
// fields are resolved from the `countries` record via resolveLeaveProfile, so
// the period math below never has to know about specific country codes.
export type LeaveProfile = {
  country?: string;
  startDate?: string;
  mode?: "calendar" | "anniversary";
  firstYearRule?: boolean;
  firstYearDays?: number;
  annualDays?: number;
  lockMonths?: number;
  annualLeaveTypeId?: Id<"leaveTypes">;
};

// Default tier/lock values when a country record doesn't set its own.
export const DEFAULT_FIRST_YEAR_DAYS = 5;
const DEFAULT_ANNUAL_DAYS = 15;
export const DEFAULT_LOCK_MONTHS = 6;

export function isAnniversary(profile: LeaveProfile): boolean {
  return profile.mode === "anniversary";
}

// Load a country's rule and fold it into a LeaveProfile. Unknown/legacy
// countries fall back to calendar mode (the Irish behaviour).
export async function resolveLeaveProfile(
  ctx: QueryCtx | MutationCtx,
  country: string | undefined,
  startDate: string | undefined,
): Promise<LeaveProfile> {
  const code = countryOf(country);
  const c = await ctx.db
    .query("countries")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  return {
    country: code,
    startDate,
    mode: c?.leaveYearMode ?? "calendar",
    firstYearRule: c?.firstYearRule ?? false,
    firstYearDays: c?.firstYearDays ?? DEFAULT_FIRST_YEAR_DAYS,
    annualDays: c?.annualDays ?? DEFAULT_ANNUAL_DAYS,
    lockMonths: c?.lockMonths ?? DEFAULT_LOCK_MONTHS,
    annualLeaveTypeId: c?.annualLeaveTypeId,
  };
}

// Resolve a profile straight from a person's profile document.
export async function leaveProfileOf(
  ctx: QueryCtx | MutationCtx,
  profile: { country?: string; startDate?: string } | null | undefined,
): Promise<LeaveProfile> {
  return resolveLeaveProfile(ctx, profile?.country, profile?.startDate);
}

// "YYYY-MM-DD" → MMDD as a number, for within-year comparisons.
function monthDayOf(iso: string): number {
  return Number(iso.slice(5, 7)) * 100 + Number(iso.slice(8, 10));
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Add `months` to an ISO date, clamping the day to the target month's length.
export function addMonthsISO(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// Which leave period a date falls into (identified by the year it starts in).
export function leavePeriodYearOf(dateISO: string, profile: LeaveProfile): number {
  if (!isAnniversary(profile) || !profile.startDate) {
    return yearOf(dateISO);
  }
  const startMD = monthDayOf(profile.startDate);
  const dy = yearOf(dateISO);
  return monthDayOf(dateISO) >= startMD ? dy : dy - 1;
}

// The current leave period for a profile.
export function currentPeriodYear(profile: LeaveProfile): number {
  return leavePeriodYearOf(new Date().toISOString().slice(0, 10), profile);
}

// The period to set up at approval time: the one containing today, or the one
// containing the start date when that's in the future (so a not-yet-started
// hire is configured for the period they're about to enter, not a stale one).
export function periodYearForApproval(profile: LeaveProfile): number {
  const today = new Date().toISOString().slice(0, 10);
  const ref =
    profile.startDate && profile.startDate > today ? profile.startDate : today;
  return leavePeriodYearOf(ref, profile);
}

// The period the employee's start date falls into (their first period), or null
// if no start date is recorded.
export function firstPeriodYear(profile: LeaveProfile): number | null {
  if (!profile.startDate) return null;
  return leavePeriodYearOf(profile.startDate, profile);
}

// Start/end dates and a display label for a leave period.
export function periodBounds(
  periodYear: number,
  profile: LeaveProfile,
): { startISO: string; endISO: string; label: string } {
  if (!isAnniversary(profile) || !profile.startDate) {
    return {
      startISO: `${periodYear}-01-01`,
      endISO: `${periodYear}-12-31`,
      label: String(periodYear),
    };
  }
  const mm = profile.startDate.slice(5, 7);
  const dd = profile.startDate.slice(8, 10);
  const startISO = `${periodYear}-${mm}-${dd}`;
  // End = the day before the next anniversary.
  const next = new Date(`${periodYear + 1}-${mm}-${dd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  const endISO = next.toISOString().slice(0, 10);
  const label = `${MONTH_ABBR[Number(mm) - 1]} ${periodYear} – ${MONTH_ABBR[next.getUTCMonth()]} ${next.getUTCFullYear()}`;
  return { startISO, endISO, label };
}
