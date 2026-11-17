import { v } from "convex/values";
import { internalMutation, mutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  requireAdmin,
  leaveProfileOf,
  currentPeriodYear,
  firstPeriodYear,
  periodBounds,
} from "./model";
import {
  getOrCreateAllowance,
  periodEntitlement,
  entitlementParts,
} from "./allowances";
import { writeAudit } from "./audit";

// Rolling unused leave into the next period is the one piece of entitlement
// that can't be derived live: "6 days expired in 2025" stops being computable
// the moment an admin edits the 2025 config. So it's materialised onto the new
// period's allowance row at rollover, and everything downstream just reads it.
//
// There's no single reset date to hang this off — countries in anniversary mode
// roll each person over on their own hire anniversary — so this runs daily and
// picks up whoever started a new period that morning.
//
// It rolls debt as well as credit. Leave books through once the allowance is
// spent, so a period can close under zero; those days were genuinely taken and
// follow the person into the new period rather than expiring with the old one.

export type CarryoverResult = {
  userId: Id<"users">;
  name?: string;
  periodYear: number;
  carriedInDays: number;
  forfeitedDays: number;
};

// Roll one person's statutory balance into `periodYear`. Returns null when
// there's nothing to do: no statutory type, no prior period, the roll already
// happened, or the balance closed level with nothing to carry either way.
async function applyCarryoverFor(
  ctx: MutationCtx,
  profile: {
    userId: Id<"users">;
    name?: string;
    country?: string;
    startDate?: string;
  },
  periodYear: number,
): Promise<CarryoverResult | null> {
  const leaveProfile = await leaveProfileOf(ctx, profile);
  const annualId = leaveProfile.annualLeaveTypeId;
  if (!annualId) return null;

  // Carryover is a statutory-PTO concept only. Every other type — unpaid,
  // sick, WFH — simply starts the new period fresh.
  const annualType = await ctx.db.get(annualId);
  if (!annualType) return null;
  // Only credit is capped by this, and only credit is optional — see below.
  const cap = annualType.carryOverMaxDays ?? 0;

  // Nothing to carry from before someone's first period.
  const first = firstPeriodYear(leaveProfile);
  if (first === null || periodYear <= first) return null;

  const target = await getOrCreateAllowance(
    ctx,
    profile.userId,
    annualId,
    periodYear,
  );
  // Idempotency guard: retries, backfills and manual runs must not stack.
  if (target.carryoverAppliedAt !== undefined) return null;

  const prevYear = periodYear - 1;
  const prevRow = await ctx.db
    .query("allowances")
    .withIndex("by_user_type_year", (q) =>
      q.eq("userId", profile.userId).eq("leaveTypeId", annualId).eq("year", prevYear),
    )
    .unique();

  const prevBase = periodEntitlement(
    annualType,
    leaveProfile,
    prevYear,
    periodBounds(prevYear, leaveProfile),
    true,
  );
  const prevTotal = entitlementParts(prevRow, prevBase).totalDays;
  const remaining = prevTotal - (prevRow?.usedDays ?? 0);

  // Unused days roll forward only where the leave type allows it, and only up
  // to its cap. A debt has neither an opt-out nor a cap: those days are
  // already taken, so they follow the person whatever the type is configured
  // to do with leftovers. Capping a debt would just hand back the difference.
  const carriedInDays =
    remaining < 0 ? remaining : cap > 0 ? Math.min(remaining, cap) : 0;
  const forfeitedDays = cap > 0 ? remaining - carriedInDays : 0;
  // Closed level, or closed up with carryover switched off — either way
  // there's nothing to record and the new row stands on its base alone.
  if (carriedInDays === 0 && forfeitedDays === 0) return null;

  await ctx.db.patch(target._id, {
    carriedInDays,
    forfeitedDays,
    carryoverAppliedAt: Date.now(),
  });

  await writeAudit(ctx, {
    action: "allowance.carryover",
    entityType: "allowance",
    entityId: target._id,
    entityName: profile.name,
    metadata: {
      leaveTypeId: annualId,
      leaveTypeName: annualType.name,
      fromPeriod: prevYear,
      toPeriod: periodYear,
      remainingAtReset: remaining,
      cap,
      carriedInDays,
      forfeitedDays,
    },
  });

  return {
    userId: profile.userId,
    name: profile.name,
    periodYear,
    carriedInDays,
    forfeitedDays,
  };
}

// Sweep everyone whose leave period begins on `dateISO` and roll their balance
// forward. Safe to run repeatedly for the same date.
async function runResets(
  ctx: MutationCtx,
  dateISO: string,
): Promise<CarryoverResult[]> {
  const profiles = await ctx.db.query("profiles").collect();
  const results: CarryoverResult[] = [];

  for (const p of profiles) {
    if (!p.active || p.status !== "active") continue;
    const leaveProfile = await leaveProfileOf(ctx, p);
    const periodYear = currentPeriodYear(leaveProfile);
    // Only act on the day the new period actually opens.
    if (periodBounds(periodYear, leaveProfile).startISO !== dateISO) continue;

    const result = await applyCarryoverFor(ctx, p, periodYear);
    if (result) results.push(result);
  }

  return results;
}

// Daily cron entry point.
export const runDailyResets = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await runResets(ctx, new Date().toISOString().slice(0, 10));
    return null;
  },
});

// Admin escape hatch: re-run a given day's resets by hand. Needed for
// backfilling periods that opened before this feature shipped, and for
// checking the numbers without waiting for a rollover.
export const runResetsForDate = mutation({
  args: { dateISO: v.string() },
  returns: v.array(
    v.object({
      userId: v.id("users"),
      name: v.optional(v.string()),
      periodYear: v.number(),
      carriedInDays: v.number(),
      forfeitedDays: v.number(),
    }),
  ),
  handler: async (ctx, { dateISO }) => {
    await requireAdmin(ctx);
    return await runResets(ctx, dateISO);
  },
});
