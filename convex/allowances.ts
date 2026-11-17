import { ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  resolveActingProfile,
  requireAdmin,
  requireTeamAccess,
  requireSuperadmin,
  isAdmin,
  isSuperadmin,
  isOnApproverTeam,
  countryOf,
  isAnniversary,
  resolveLeaveProfile,
  currentPeriodYear,
  firstPeriodYear,
  periodBounds,
  periodYearForApproval,
  leavePeriodYearOf,
  sortLeaveTypes,
  type LeaveProfile,
} from "./model";

// Find or lazily create the allowance row for a person / type / year. The row
// only tracks usage + an optional override; entitlement otherwise follows the
// leave type's live default.
export async function getOrCreateAllowance(
  ctx: MutationCtx,
  userId: Id<"users">,
  leaveTypeId: Id<"leaveTypes">,
  year: number,
) {
  const existing = await ctx.db
    .query("allowances")
    .withIndex("by_user_type_year", (q) =>
      q.eq("userId", userId).eq("leaveTypeId", leaveTypeId).eq("year", year),
    )
    .unique();
  if (existing) return existing;

  const id = await ctx.db.insert("allowances", {
    userId,
    leaveTypeId,
    year,
    usedDays: 0,
  });
  return (await ctx.db.get(id))!;
}

// Recompute `usedDays` on a person's allowance rows from their approved
// requests. Usage is bucketed by LEAVE PERIOD, and for anniversary countries
// the period depends on the person's start date — so editing their start date
// or country silently re-files their entire history. Nothing re-ran this, which
// stranded usage in calendar years for anyone whose start date landed AFTER
// their leave did (spreadsheet import, onboarding approval). Idempotent.
//
// Deliberately only touches usedDays. overrideDays / carriedInDays are admin
// intent, not derived facts, so they stay where they were put.
export async function reconcileUsage(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const lp = await resolveLeaveProfile(ctx, profile?.country, profile?.startDate);

  const approved = await ctx.db
    .query("leaveRequests")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "approved"),
    )
    .collect();
  const want = new Map<string, number>();
  for (const r of approved) {
    const key = `${r.leaveTypeId}~${leavePeriodYearOf(r.startDate, lp)}`;
    want.set(key, (want.get(key) ?? 0) + r.days);
  }

  let changed = 0;
  // Existing rows first — a row whose period no longer holds any leave gets
  // zeroed rather than deleted, so any override or carryover on it survives.
  const rows = await ctx.db
    .query("allowances")
    .withIndex("by_user_year", (q) => q.eq("userId", userId))
    .collect();
  for (const row of rows) {
    const key = `${row.leaveTypeId}~${row.year}`;
    const target = want.get(key) ?? 0;
    want.delete(key);
    if (row.usedDays !== target) {
      await ctx.db.patch(row._id, { usedDays: target });
      changed++;
    }
  }
  // Periods that hold leave but have no row yet.
  for (const [key, days] of want) {
    const [typeId, periodYear] = key.split("~");
    const row = await getOrCreateAllowance(
      ctx,
      userId,
      typeId as Id<"leaveTypes">,
      Number(periodYear),
    );
    if (row.usedDays !== days) {
      await ctx.db.patch(row._id, { usedDays: days });
    }
    changed++;
  }
  return changed;
}

type AllowanceRow = {
  overrideDays?: number;
  carriedInDays?: number;
  extraDays?: number;
  usedDays?: number;
};

export type AllowanceParts = {
  // The statutory/configured floor: the type default, or an admin override.
  baseDays: number;
  carriedInDays: number;
  extraDays: number;
  totalDays: number;
};

// Break an allowance into its three components. An admin override replaces the
// base only — carried-over and extra days still stack on top of it, so an
// override never silently swallows leave the person is separately owed.
export function entitlementParts(
  row: AllowanceRow | null | undefined,
  leaveTypeDefault: number,
): AllowanceParts {
  const baseDays = row?.overrideDays ?? leaveTypeDefault;
  const carriedInDays = row?.carriedInDays ?? 0;
  const extraDays = row?.extraDays ?? 0;
  return {
    baseDays,
    carriedInDays,
    extraDays,
    totalDays: baseDays + carriedInDays + extraDays,
  };
}

// Effective entitlement — what the person may actually book this period.
export function entitlement(
  row: AllowanceRow | null | undefined,
  leaveTypeDefault: number,
): number {
  return entitlementParts(row, leaveTypeDefault).totalDays;
}

// Split days taken across the components, spending carried-over days first so
// rolled-forward leave is used before it can expire at the next reset. This is
// presentation only — booking still just increments `usedDays` — but it's what
// makes the admin breakdown honest about which bucket a day came out of.
export function spendBreakdown(parts: AllowanceParts, usedDays: number) {
  // A negative carry is debt brought forward, not a bucket to spend from —
  // clamp it out so the split can't report days taken "from carryover" that
  // were never there to take.
  const fromCarried = Math.max(0, Math.min(usedDays, parts.carriedInDays));
  const fromExtra = Math.min(usedDays - fromCarried, parts.extraDays);
  return {
    fromCarried,
    fromExtra,
    fromBase: usedDays - fromCarried - fromExtra,
    carriedRemaining: parts.carriedInDays - fromCarried,
  };
}

function daysInclusive(startISO: string, endISO: string): number {
  const s = Date.parse(`${startISO}T00:00:00Z`);
  const e = Date.parse(`${endISO}T00:00:00Z`);
  return Math.round((e - s) / 86_400_000) + 1;
}

// Pro-rate a full entitlement over a leave period, counting from the later of
// the period start and the employee's hire date. Rounded to the nearest
// half-day. A hire date on/before the period start gets the full amount; a hire
// date after the period end gets nothing.
export function proRateOverPeriod(
  fullDays: number,
  hireISO: string | undefined,
  periodStartISO: string,
  periodEndISO: string,
): number {
  if (!hireISO || hireISO <= periodStartISO) return fullDays;
  if (hireISO > periodEndISO) return 0;
  const prorated =
    (fullDays * daysInclusive(hireISO, periodEndISO)) /
    daysInclusive(periodStartISO, periodEndISO);
  return Math.round(prorated * 2) / 2;
}

type LeaveTypeEntitlement = {
  defaultAllowanceDays: number;
  deductsAllowance: boolean;
};

// Base entitlement (before any per-person override) for a leave type in a given
// period. Every deducting type grants its own days/yr, pro-rated over the period
// (a full year except in a joiner's first year). Exception: if the country has
// the optional first-year rule on, the statutory type grants a fixed
// firstYearDays in the joining period instead of pro-rating.
export function periodEntitlement(
  type: LeaveTypeEntitlement,
  profile: LeaveProfile,
  periodYear: number,
  bounds: { startISO: string; endISO: string },
  isStatutoryAnnual: boolean,
): number {
  if (!type.deductsAllowance) return type.defaultAllowanceDays;
  if (profile.firstYearRule && isStatutoryAnnual) {
    const first = firstPeriodYear(profile);
    if (first !== null && periodYear === first) {
      return profile.firstYearDays ?? 0;
    }
  }
  return proRateOverPeriod(
    type.defaultAllowanceDays,
    profile.startDate,
    bounds.startISO,
    bounds.endISO,
  );
}

// Active leave types belonging to a country. Legacy rows with no countryCode
// count as the default country ("IE").
export async function activeTypesForCountry(
  ctx: QueryCtx,
  code: string,
) {
  const all = await ctx.db.query("leaveTypes").collect();
  return sortLeaveTypes(
    all.filter((t) => t.active && countryOf(t.countryCode) === code),
  );
}

async function balancesFor(
  ctx: QueryCtx,
  userId: Id<"users">,
  year?: number,
  opts?: { includeInternal?: boolean },
) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const leaveProfile = await resolveLeaveProfile(
    ctx,
    profile?.country,
    profile?.startDate,
  );
  const periodYear = year ?? currentPeriodYear(leaveProfile);
  const bounds = periodBounds(periodYear, leaveProfile);

  const types = await activeTypesForCountry(ctx, countryOf(profile?.country));
  const rows = await ctx.db
    .query("allowances")
    .withIndex("by_user_year", (q) =>
      q.eq("userId", userId).eq("year", periodYear),
    )
    .collect();
  const byType = new Map(rows.map((r) => [r.leaveTypeId, r]));

  // Unlimited (non-deducting) types don't track usage in allowance rows, so
  // derive "days taken" from the person's approved requests that fall in this
  // leave period. Bucketing by the request's start date mirrors how deducting
  // usage is attributed on approval.
  const approved = await ctx.db
    .query("leaveRequests")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "approved"),
    )
    .collect();
  const takenByType = new Map<Id<"leaveTypes">, number>();
  for (const r of approved) {
    if (leavePeriodYearOf(r.startDate, leaveProfile) !== periodYear) continue;
    takenByType.set(r.leaveTypeId, (takenByType.get(r.leaveTypeId) ?? 0) + r.days);
  }

  const balances = types.map((t) => {
    const row = byType.get(t._id);
    if (!t.deductsAllowance) {
      // Uncapped type: no entitlement or remaining, just the tally of days
      // taken. The internal soft cap is admin-only and never sent to the
      // employee's own view.
      const used = takenByType.get(t._id) ?? 0;
      return {
        leaveTypeId: t._id,
        name: t.name,
        color: t.color,
        deductsAllowance: false,
        totalDays: 0,
        usedDays: used,
        remainingDays: 0,
        overridden: false,
        internalCap:
          opts?.includeInternal && t.defaultAllowanceDays > 0
            ? t.defaultAllowanceDays
            : undefined,
      };
    }
    // An explicit admin override always wins over the calculated entitlement.
    const base = periodEntitlement(
      t,
      leaveProfile,
      periodYear,
      bounds,
      t._id === leaveProfile.annualLeaveTypeId,
    );
    const parts = entitlementParts(row, base);
    const used = row?.usedDays ?? 0;
    return {
      leaveTypeId: t._id,
      name: t.name,
      color: t.color,
      deductsAllowance: true,
      totalDays: parts.totalDays,
      usedDays: used,
      remainingDays: parts.totalDays - used,
      overridden: row?.overrideDays !== undefined,
      internalCap: undefined as number | undefined,
      // How the total is composed, plus what the last reset carried and
      // forfeited. Admin-only: employees see a single total for their PTO and
      // never the base/carryover/extra split behind it.
      breakdown: opts?.includeInternal
        ? {
            ...parts,
            ...spendBreakdown(parts, used),
            forfeitedDays: row?.forfeitedDays ?? 0,
          }
        : undefined,
    };
  });

  return {
    periodYear,
    label: bounds.label,
    periodStart: bounds.startISO,
    periodEnd: bounds.endISO,
    annualLeaveTypeId: leaveProfile.annualLeaveTypeId ?? null,
    balances,
  };
}

// Balances for the acting user (self or impersonated), for a leave period.
export const myAllowance = query({
  args: {
    year: v.optional(v.number()),
    // Resolve the period from a date rather than from today. The booking form
    // needs "what's left in the leave year this request lands in", which isn't
    // the year we're standing in when someone books across a reset.
    forDate: v.optional(v.string()),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { year, forDate, asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    let periodYear = year;
    if (periodYear === undefined && forDate) {
      const lp = await resolveLeaveProfile(
        ctx,
        profile.country,
        profile.startDate,
      );
      periodYear = leavePeriodYearOf(forDate, lp);
    }
    return await balancesFor(ctx, profile.userId, periodYear);
  },
});

// Balances for a member (member detail view). Admins see anyone; office
// managers see only their own team.
export const forUser = query({
  args: { userId: v.id("users"), year: v.optional(v.number()) },
  handler: async (ctx, { userId, year }) => {
    await requireTeamAccess(ctx, userId);
    return await balancesFor(ctx, userId, year, { includeInternal: true });
  },
});

// Admin: preview the entitlement a person would get for a given country +
// start date, before they're approved. Drives the approval modal so the admin
// sees (and can tweak) exactly what the new hire will receive. Uses the same
// period math as live balances, so the preview matches reality.
export const previewForApproval = query({
  args: { startDate: v.string(), country: v.string() },
  handler: async (ctx, { startDate, country }) => {
    await requireAdmin(ctx);
    const profile = await resolveLeaveProfile(ctx, country, startDate);
    const periodYear = periodYearForApproval(profile);
    const bounds = periodBounds(periodYear, profile);
    const types = await activeTypesForCountry(ctx, countryOf(country));
    return {
      periodYear,
      label: bounds.label,
      types: types.map((t) => ({
        leaveTypeId: t._id,
        name: t.name,
        color: t.color,
        deductsAllowance: t.deductsAllowance,
        days: periodEntitlement(
          t,
          profile,
          periodYear,
          bounds,
          t._id === profile.annualLeaveTypeId,
        ),
      })),
    };
  },
});

// Admin: dashboard roster for one country. Columns are driven entirely by that
// country's configured leave types (no hardcoded sick/WFH) — the statutory
// annual type carries allowance/used/left, every other configured type reports
// days taken this period. Scoped per country because leave types are per
// country, so a single flat column set can never fit both offices.
export const roster = query({
  args: {
    country: v.string(),
    year: v.optional(v.number()),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { country, year, asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!isAdmin(me.role)) throw new ConvexError("Admins only.");
    const code = countryOf(country);

    const countryRow = await ctx.db
      .query("countries")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const annualId = countryRow?.annualLeaveTypeId ?? null;

    const types = await activeTypesForCountry(ctx, code);
    const annualType = types.find((t) => t._id === annualId) ?? null;
    const otherTypes = types
      .filter((t) => t._id !== annualId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const departments = await ctx.db.query("departments").collect();
    const deptName = new Map(departments.map((d) => [d._id, d.name]));

    const profiles = await ctx.db.query("profiles").collect();
    let staff = profiles.filter(
      (p) =>
        p.active &&
        p.status === "active" &&
        !p.hiddenFromRoster &&
        countryOf(p.country) === code,
    );
    // This is dashboard data, so it follows the viewer's remit: superadmins
    // see the whole country, everyone else only the people they approve for.
    if (!isSuperadmin(me.role)) {
      staff = (
        await Promise.all(
          staff.map(async (p) =>
            (await isOnApproverTeam(ctx, me, p.userId)) ? p : null,
          ),
        )
      ).filter((p): p is NonNullable<typeof p> => p !== null);
    }

    const rows = [];
    for (const p of staff) {
      const bal = await balancesFor(ctx, p.userId, year, {
        includeInternal: true,
      });
      const byType = new Map(bal.balances.map((b) => [b.leaveTypeId, b]));
      const annual = annualId ? byType.get(annualId) : undefined;
      const taken: Record<string, number> = {};
      for (const t of otherTypes) {
        taken[t._id] = byType.get(t._id)?.usedDays ?? 0;
      }
      rows.push({
        userId: p.userId,
        name: p.name,
        office: p.departmentId ? (deptName.get(p.departmentId) ?? null) : null,
        startDate: p.startDate ?? null,
        resetDate: bal.periodEnd,
        annualTotal: annual?.totalDays ?? null,
        annualUsed: annual?.usedDays ?? null,
        annualRemaining: annual?.remainingDays ?? null,
        taken,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      annualType: annualType
        ? { leaveTypeId: annualType._id, name: annualType.name }
        : null,
      otherTypes: otherTypes.map((t) => ({
        leaveTypeId: t._id,
        name: t.name,
        color: t.color,
      })),
      rows,
    };
  },
});

// Admin: set or clear a per-person entitlement override. Pass days = null to
// clear (revert to the leave type default).
export const setOverride = mutation({
  args: {
    userId: v.id("users"),
    leaveTypeId: v.id("leaveTypes"),
    year: v.number(),
    days: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { userId, leaveTypeId, year, days }) => {
    await requireAdmin(ctx);
    const row = await getOrCreateAllowance(ctx, userId, leaveTypeId, year);
    await ctx.db.patch(row._id, {
      overrideDays:
        days === null ? undefined : Math.max(0, Math.floor(days)),
    });
  },
});

// Admin: grant days on top of the entitlement — long-service awards, extra
// negotiated at hire, goodwill. Deliberately separate from `setOverride`: extra
// days are a one-period gift and must not redefine the base the person is due
// every year after. Pass days = null to clear.
export const setExtraDays = mutation({
  args: {
    userId: v.id("users"),
    leaveTypeId: v.id("leaveTypes"),
    year: v.number(),
    days: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { userId, leaveTypeId, year, days }) => {
    await requireAdmin(ctx);
    const row = await getOrCreateAllowance(ctx, userId, leaveTypeId, year);
    await ctx.db.patch(row._id, {
      extraDays: days === null ? undefined : Math.max(0, Math.floor(days)),
    });
  },
});

// Superadmin: re-derive stored usage from approved requests for one person or
// everyone. This is the repair hatch for rows written while a person's start
// date or country was still missing — their leave got filed under a calendar
// year instead of their anniversary period, so balances read far too low.
// Returns what moved so the run can be checked before and after.
export const reconcile = mutation({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    await requireSuperadmin(ctx);
    const targets = userId
      ? [userId]
      : (await ctx.db.query("profiles").collect()).map((p) => p.userId);
    let rowsChanged = 0;
    const touched: string[] = [];
    for (const uid of targets) {
      const n = await reconcileUsage(ctx, uid);
      if (n > 0) {
        rowsChanged += n;
        const p = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", uid))
          .unique();
        touched.push(p?.name ?? uid);
      }
    }
    return { people: targets.length, rowsChanged, touched };
  },
});

// Same repair, callable by the CLI/scheduler rather than a signed-in admin.
// The public mutation above needs a superadmin session; a backfill has none.
export const reconcileAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("profiles").collect();
    const touched: { name: string; rows: number }[] = [];
    for (const p of profiles) {
      const n = await reconcileUsage(ctx, p.userId);
      if (n > 0) touched.push({ name: p.name, rows: n });
    }
    return { people: profiles.length, touched };
  },
});
