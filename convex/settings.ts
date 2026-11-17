import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireProfile, requireSuperadmin } from "./model";
import { writeAudit } from "./audit";

export const calendarScopeValidator = v.union(
  v.literal("company"),
  v.literal("department"),
);

// Company-wide settings, readable by any signed-in user. Defaults are applied
// here so callers never see an empty/missing row.
export const get = query({
  args: {},
  returns: v.object({ calendarScope: calendarScopeValidator }),
  handler: async (ctx) => {
    await requireProfile(ctx);
    const row = await ctx.db.query("orgSettings").first();
    return {
      calendarScope: row?.calendarScope ?? "company",
    };
  },
});

export const setCalendarScope = mutation({
  args: { calendarScope: calendarScopeValidator },
  returns: v.null(),
  handler: async (ctx, { calendarScope }) => {
    const actor = await requireSuperadmin(ctx);
    const existing = await ctx.db.query("orgSettings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { calendarScope });
    } else {
      await ctx.db.insert("orgSettings", { calendarScope });
    }
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "settings.calendar_scope_changed",
      entityType: "settings",
      entityName:
        calendarScope === "company"
          ? "Calendar shows the whole company"
          : "Calendar shows same department only",
    });
  },
});
