import { internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// One-shot, idempotent migration to the per-country model. Safe to re-run.
// Run via:  npx convex run migrations:perCountry  (or the MCP run tool).
//
//  1. Seed IE (calendar) and TR (anniversary) countries.
//  2. Tag every legacy leave type (no countryCode) as IE.
//  3. Move the old isAnnual designation + TR tier fields onto the country
//     records (statutory config now lives on `countries`).
//  4. Clone IE's active types into a starter TR set so TR has its own types.
export const perCountry = internalMutation({
  args: {},
  handler: async (ctx) => {
    const notes: string[] = [];

    // 1. Countries.
    async function ensureCountry(
      code: string,
      name: string,
      mode: "calendar" | "anniversary",
    ): Promise<Id<"countries">> {
      const existing = await ctx.db
        .query("countries")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (existing) return existing._id;
      notes.push(`created country ${code}`);
      return ctx.db.insert("countries", {
        code,
        name,
        leaveYearMode: mode,
        active: true,
      });
    }
    const ieId = await ensureCountry("IE", "Ireland", "calendar");
    const trId = await ensureCountry("TR", "Türkiye", "anniversary");

    // 2. Tag legacy leave types as IE.
    const allTypes = await ctx.db.query("leaveTypes").collect();
    for (const t of allTypes) {
      if (t.countryCode === undefined) {
        await ctx.db.patch(t._id, { countryCode: "IE" });
        notes.push(`tagged "${t.name}" as IE`);
      }
    }

    // 3. Carry the old statutory designation + TR tiers onto the countries.
    const legacyAnnual = allTypes.find((t) => t.isAnnual);
    if (legacyAnnual) {
      const ie = await ctx.db.get(ieId);
      if (ie && ie.annualLeaveTypeId === undefined) {
        await ctx.db.patch(ieId, { annualLeaveTypeId: legacyAnnual._id });
      }
      const tr = await ctx.db.get(trId);
      if (tr && tr.firstYearDays === undefined) {
        await ctx.db.patch(trId, {
          firstYearDays: legacyAnnual.trFirstYearDays ?? 5,
          annualDays: legacyAnnual.trAnnualDays ?? 15,
          lockMonths: 6,
        });
        notes.push("moved TR tiers onto country");
      }
    } else {
      // No prior annual type — set sane TR defaults so the tiers aren't empty.
      const tr = await ctx.db.get(trId);
      if (tr && tr.firstYearDays === undefined) {
        await ctx.db.patch(trId, {
          firstYearDays: 5,
          annualDays: 15,
          lockMonths: 6,
        });
      }
    }

    // 4. Clone IE's active types into a starter TR set (only if TR has none).
    const trTypes = await ctx.db
      .query("leaveTypes")
      .withIndex("by_country", (q) => q.eq("countryCode", "TR"))
      .collect();
    if (trTypes.length === 0) {
      const ieActive = (await ctx.db.query("leaveTypes").collect()).filter(
        (t) => (t.countryCode ?? "IE") === "IE" && t.active,
      );
      let trAnnualId: Id<"leaveTypes"> | undefined;
      for (const t of ieActive) {
        const id = await ctx.db.insert("leaveTypes", {
          name: t.name,
          color: t.color,
          countryCode: "TR",
          defaultAllowanceDays: t.defaultAllowanceDays,
          deductsAllowance: t.deductsAllowance,
          active: true,
        });
        if (legacyAnnual && t._id === legacyAnnual._id) trAnnualId = id;
      }
      if (trAnnualId) {
        await ctx.db.patch(trId, { annualLeaveTypeId: trAnnualId });
      }
      notes.push(`cloned ${ieActive.length} types into TR`);
    }

    // 5. Ensure every country has a statutory annual type designated. Prefer a
    //    deducting type literally named "Annual Leave", else the first
    //    deducting type. Leaves an explicit prior choice untouched.
    const countries = await ctx.db.query("countries").collect();
    for (const c of countries) {
      if (c.annualLeaveTypeId) continue;
      const owned = (
        await ctx.db
          .query("leaveTypes")
          .withIndex("by_country", (q) => q.eq("countryCode", c.code))
          .collect()
      ).filter((t) => t.active && t.deductsAllowance);
      const pick =
        owned.find((t) => t.name.toLowerCase() === "annual leave") ?? owned[0];
      if (pick) {
        await ctx.db.patch(c._id, { annualLeaveTypeId: pick._id });
        notes.push(`designated ${c.code} annual = "${pick.name}"`);
      }
    }

    return { ok: true, notes };
  },
});
