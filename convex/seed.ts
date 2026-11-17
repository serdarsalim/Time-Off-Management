import { mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireAdmin } from "./model";

// One-shot: create default leave types and a couple of departments.
// Safe to run more than once — it skips anything that already exists.
export const run = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    // Countries first — leave types belong to one. IE = calendar year,
    // TR = employment-anniversary year with tiered annual leave.
    async function ensureCountry(
      code: string,
      name: string,
      mode: "calendar" | "anniversary",
      extra: { firstYearDays?: number; annualDays?: number; lockMonths?: number } = {},
    ) {
      const existing = await ctx.db
        .query("countries")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (existing) return existing._id;
      return ctx.db.insert("countries", {
        code,
        name,
        leaveYearMode: mode,
        active: true,
        ...extra,
      });
    }
    const ieId = await ensureCountry("IE", "Ireland", "calendar");
    await ensureCountry("TR", "Türkiye", "anniversary", {
      firstYearDays: 5,
      annualDays: 15,
      lockMonths: 6,
    });

    const existingTypes = await ctx.db.query("leaveTypes").collect();
    if (existingTypes.length === 0) {
      const defaults = [
        { name: "Annual Leave", color: "#0e7a5f", defaultAllowanceDays: 25, deductsAllowance: true },
        { name: "Sick Leave", color: "#e85d75", defaultAllowanceDays: 10, deductsAllowance: true },
        { name: "Unpaid Leave", color: "#9ca3af", defaultAllowanceDays: 0, deductsAllowance: false },
        { name: "Work From Home", color: "#f0c419", defaultAllowanceDays: 0, deductsAllowance: false },
      ];
      let annualId: Id<"leaveTypes"> | undefined;
      for (const t of defaults) {
        const id = await ctx.db.insert("leaveTypes", {
          ...t,
          countryCode: "IE",
          active: true,
        });
        if (t.name === "Annual Leave") annualId = id;
      }
      if (annualId) await ctx.db.patch(ieId, { annualLeaveTypeId: annualId });
    }

    const existingDepts = await ctx.db.query("departments").collect();
    if (existingDepts.length === 0) {
      for (const name of ["Operations", "Recruitment", "Marketing"]) {
        await ctx.db.insert("departments", { name });
      }
    }

    return { ok: true };
  },
});
