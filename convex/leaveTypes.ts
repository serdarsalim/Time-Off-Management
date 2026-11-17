import { ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  requireProfile,
  requireSuperadmin,
  resolveViewedProfile,
  countryOf,
  sortLeaveTypes,
} from "./model";
import { writeAudit } from "./audit";

// Active leave types. Pass `country` to scope to one country's types (legacy
// rows with no countryCode count as the default "IE"); omit for all of them.
export const list = query({
  args: { country: v.optional(v.string()) },
  handler: async (ctx, { country }) => {
    await requireProfile(ctx);
    const rows = await ctx.db.query("leaveTypes").collect();
    const all = sortLeaveTypes(rows.filter((t) => t.active));
    if (country === undefined) return all;
    return all.filter((t) => countryOf(t.countryCode) === countryOf(country));
  },
});

// Active leave types for the person the form is about — self, an impersonated
// user, or (for admins) anyone they're entering leave for. Scoped to that
// person's country. This is what the booking form should use.
export const listForMe = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveViewedProfile(ctx, asUserId);
    const all = await ctx.db.query("leaveTypes").collect();
    return sortLeaveTypes(
      all.filter(
        (t) =>
          t.active && countryOf(t.countryCode) === countryOf(profile.country),
      ),
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    countryCode: v.string(),
    defaultAllowanceDays: v.number(),
    deductsAllowance: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSuperadmin(ctx);
    const countryCode = args.countryCode.trim().toUpperCase();
    const country = await ctx.db
      .query("countries")
      .withIndex("by_code", (q) => q.eq("code", countryCode))
      .unique();
    if (!country) throw new ConvexError("Unknown country for this leave type.");
    // New types land at the bottom of their country's list.
    const siblings = await ctx.db
      .query("leaveTypes")
      .withIndex("by_country", (q) => q.eq("countryCode", countryCode))
      .collect();
    const sortOrder =
      siblings.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), -1) + 1;
    const id = await ctx.db.insert("leaveTypes", {
      ...args,
      countryCode,
      active: true,
      sortOrder,
    });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "leaveType.created",
      entityType: "leaveType",
      entityId: id,
      entityName: `${args.name} (${countryCode})`,
    });
    return id;
  },
});

// Archive a leave type — hidden from the picker and balances, but kept so
// historical requests still resolve its name/colour.
export const archive = mutation({
  args: { leaveTypeId: v.id("leaveTypes") },
  handler: async (ctx, { leaveTypeId }) => {
    const actor = await requireSuperadmin(ctx);
    const t = await ctx.db.get(leaveTypeId);
    await ctx.db.patch(leaveTypeId, { active: false });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "leaveType.removed",
      entityType: "leaveType",
      entityId: leaveTypeId,
      entityName: t?.name,
    });
  },
});

export const update = mutation({
  args: {
    leaveTypeId: v.id("leaveTypes"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultAllowanceDays: v.optional(v.number()),
    deductsAllowance: v.optional(v.boolean()),
    allowDoc: v.optional(v.boolean()),
    showInLegend: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
    carryOverMaxDays: v.optional(v.number()),
  },
  handler: async (ctx, { leaveTypeId, ...patch }) => {
    await requireSuperadmin(ctx);
    await ctx.db.patch(leaveTypeId, patch);
  },
});

// Rewrite the display order for one country. `orderedIds` is the country's
// active types top to bottom; positions are renumbered from 0 so the sequence
// stays dense no matter how many drags it took to get here.
export const reorder = mutation({
  args: { orderedIds: v.array(v.id("leaveTypes")) },
  handler: async (ctx, { orderedIds }) => {
    await requireSuperadmin(ctx);
    for (const [i, id] of orderedIds.entries()) {
      await ctx.db.patch(id, { sortOrder: i });
    }
  },
});
