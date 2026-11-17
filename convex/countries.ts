import { ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import {
  requireProfile,
  requireSuperadmin,
  countryOf,
  getCountryWorkDays,
  resolveViewedProfile,
  DEFAULT_FIRST_YEAR_DAYS,
  DEFAULT_LOCK_MONTHS,
} from "./model";
import { writeAudit } from "./audit";

const leaveYearModeValidator = v.union(
  v.literal("calendar"),
  v.literal("anniversary"),
);

// All configured countries, sorted by name. Readable by any signed-in user —
// the country pickers throughout the app are driven by this.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireProfile(ctx);
    const rows = await ctx.db.query("countries").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// The country work week (day indices 0=Sun … 6=Sat) of the person in view —
// self, or anyone an admin is entering leave for. Used to preview leave-day
// counts and shade non-working days in the calendar.
export const workDaysForMe = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveViewedProfile(ctx, asUserId);
    return await getCountryWorkDays(ctx, profile.country);
  },
});

// Set a country's working weekdays. Pass day indices 0=Sun … 6=Sat.
export const setWorkDays = mutation({
  args: {
    countryId: v.id("countries"),
    workDays: v.array(v.number()),
  },
  handler: async (ctx, { countryId, workDays }) => {
    await requireSuperadmin(ctx);
    // Normalise: unique, valid 0–6, sorted. Empty is allowed but means the
    // counting falls back to Mon–Fri, so guard against an all-non-working week.
    const clean = [...new Set(workDays)]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    if (clean.length === 0) {
      throw new ConvexError("A country needs at least one working day.");
    }
    await ctx.db.patch(countryId, { workDays: clean });
  },
});

// Internal: all configured country codes, for the yearly holiday-import cron.
export const listCodes = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const rows = await ctx.db.query("countries").collect();
    return rows.map((r) => r.code);
  },
});

export const create = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    leaveYearMode: leaveYearModeValidator,
  },
  handler: async (ctx, { code, name, leaveYearMode }) => {
    const actor = await requireSuperadmin(ctx);
    const c = code.trim().toUpperCase();
    const n = name.trim();
    if (!c || !n) throw new ConvexError("Country code and name are required.");
    const existing = await ctx.db
      .query("countries")
      .withIndex("by_code", (q) => q.eq("code", c))
      .unique();
    if (existing) throw new ConvexError(`Country “${c}” already exists.`);
    const id = await ctx.db.insert("countries", {
      code: c,
      name: n,
      leaveYearMode,
      active: true,
    });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "country.created",
      entityType: "country",
      entityId: id,
      entityName: `${n} (${c})`,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    countryId: v.id("countries"),
    name: v.optional(v.string()),
    leaveYearMode: v.optional(leaveYearModeValidator),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { countryId, ...patch }) => {
    await requireSuperadmin(ctx);
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) throw new ConvexError("Country name can't be empty.");
      patch.name = n;
    }
    await ctx.db.patch(countryId, patch);
  },
});

// Designate this country's statutory annual leave type and (for anniversary
// mode) its tier amounts + first-period lock. Drives the "Statutory annual
// leave" settings card.
export const setAnnualConfig = mutation({
  args: {
    countryId: v.id("countries"),
    annualLeaveTypeId: v.optional(v.union(v.id("leaveTypes"), v.null())),
    firstYearRule: v.optional(v.boolean()),
    firstYearDays: v.optional(v.number()),
    annualDays: v.optional(v.number()),
    lockMonths: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      countryId,
      annualLeaveTypeId,
      firstYearRule,
      firstYearDays,
      annualDays,
      lockMonths,
    },
  ) => {
    await requireSuperadmin(ctx);
    const country = await ctx.db.get(countryId);
    if (!country) throw new ConvexError("Country not found.");
    const patch: Record<string, unknown> = {};
    if (annualLeaveTypeId !== undefined) {
      // A null clears the designation; a value must be one of this country's
      // own leave types.
      if (annualLeaveTypeId === null) {
        patch.annualLeaveTypeId = undefined;
      } else {
        const type = await ctx.db.get(annualLeaveTypeId);
        if (!type || countryOf(type.countryCode) !== country.code) {
          throw new ConvexError("That leave type isn't in this country.");
        }
        patch.annualLeaveTypeId = annualLeaveTypeId;
        // Annual leave never needs a supporting document, so its row stops
        // offering the toggle. Clear anything already set on the way in —
        // otherwise the upload would sit on the request form with no control
        // left to switch it off.
        if (type.allowDoc) {
          await ctx.db.patch(annualLeaveTypeId, { allowDoc: false });
        }
      }
    }
    if (firstYearRule !== undefined) {
      patch.firstYearRule = firstYearRule;
      // Switching the rule on makes two numbers load-bearing. Left unset they
      // fall back to code defaults, so the settings card displays a figure the
      // database never stored — and a change to the default would silently
      // move every country riding on it. Write them down instead.
      if (firstYearRule) {
        if (firstYearDays === undefined && country.firstYearDays === undefined) {
          patch.firstYearDays = DEFAULT_FIRST_YEAR_DAYS;
        }
        if (lockMonths === undefined && country.lockMonths === undefined) {
          patch.lockMonths = DEFAULT_LOCK_MONTHS;
        }
      }
    }
    if (firstYearDays !== undefined)
      patch.firstYearDays = Math.max(0, firstYearDays);
    if (annualDays !== undefined) patch.annualDays = Math.max(0, annualDays);
    if (lockMonths !== undefined) patch.lockMonths = Math.max(0, lockMonths);
    await ctx.db.patch(countryId, patch);
  },
});

// Remove a country. Blocked while anyone is assigned to it or it still owns
// leave types — clear those first so we never orphan people or entitlements.
export const remove = mutation({
  args: { countryId: v.id("countries") },
  handler: async (ctx, { countryId }) => {
    const actor = await requireSuperadmin(ctx);
    const country = await ctx.db.get(countryId);
    if (!country) return;

    const profiles = await ctx.db.query("profiles").collect();
    const assigned = profiles.filter(
      (p) => countryOf(p.country) === country.code,
    ).length;
    if (assigned > 0) {
      throw new ConvexError(
        `${assigned} ${assigned === 1 ? "person is" : "people are"} assigned to ${country.name}. Reassign them first.`,
      );
    }
    const types = await ctx.db
      .query("leaveTypes")
      .withIndex("by_country", (q) => q.eq("countryCode", country.code))
      .collect();
    const activeTypes = types.filter((t) => t.active);
    if (activeTypes.length > 0) {
      throw new ConvexError(
        `${country.name} still has ${activeTypes.length} leave type(s). Remove them first.`,
      );
    }
    await ctx.db.delete(countryId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "country.removed",
      entityType: "country",
      entityId: countryId,
      entityName: `${country.name} (${country.code})`,
    });
  },
});

// One-off: countries whose first-year rule was switched on before the numbers
// were persisted have been running on code defaults. Write the values they've
// effectively been using so the stored config matches the behaviour.
export const pinRuleDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("countries").collect();
    const pinned: { code: string; firstYearDays?: number; lockMonths?: number }[] =
      [];
    for (const c of rows) {
      if (!c.firstYearRule) continue;
      const patch: Record<string, number> = {};
      if (c.firstYearDays === undefined) {
        patch.firstYearDays = DEFAULT_FIRST_YEAR_DAYS;
      }
      if (c.lockMonths === undefined) patch.lockMonths = DEFAULT_LOCK_MONTHS;
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch(c._id, patch);
      pinned.push({ code: c.code, ...patch });
    }
    return { countries: rows.length, pinned };
  },
});
