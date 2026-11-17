import { ConvexError } from "convex/values";
import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import {
  requireProfile,
  requireSuperadmin,
  resolveViewedProfile,
  yearOf,
  countryOf,
} from "./model";
import { writeAudit } from "./audit";

// Irish public holidays (Republic of Ireland), 2025–2027.
const IRISH_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-02-03", name: "St Brigid's Day" },
  { date: "2025-03-17", name: "St Patrick's Day" },
  { date: "2025-04-21", name: "Easter Monday" },
  { date: "2025-05-05", name: "May Day" },
  { date: "2025-06-02", name: "June Bank Holiday" },
  { date: "2025-08-04", name: "August Bank Holiday" },
  { date: "2025-10-27", name: "October Bank Holiday" },
  { date: "2025-12-25", name: "Christmas Day" },
  { date: "2025-12-26", name: "St Stephen's Day" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-02", name: "St Brigid's Day" },
  { date: "2026-03-17", name: "St Patrick's Day" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-05-04", name: "May Day" },
  { date: "2026-06-01", name: "June Bank Holiday" },
  { date: "2026-08-03", name: "August Bank Holiday" },
  { date: "2026-10-26", name: "October Bank Holiday" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "St Stephen's Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-01", name: "St Brigid's Day" },
  { date: "2027-03-17", name: "St Patrick's Day" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-05-03", name: "May Day" },
  { date: "2027-06-07", name: "June Bank Holiday" },
  { date: "2027-08-02", name: "August Bank Holiday" },
  { date: "2027-10-25", name: "October Bank Holiday" },
  { date: "2027-12-25", name: "Christmas Day" },
  { date: "2027-12-26", name: "St Stephen's Day" },
];

// Turkish public holidays, 2025–2027. National days are fixed; religious feasts
// (Ramazan/Kurban Bayramı) follow the lunar calendar and are best-effort per
// Diyanet announcements — admins can adjust exact dates if they shift.
const TURKISH_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-03-30", name: "Ramazan Bayramı" },
  { date: "2025-03-31", name: "Ramazan Bayramı" },
  { date: "2025-04-01", name: "Ramazan Bayramı" },
  { date: "2025-04-23", name: "National Sovereignty & Children's Day" },
  { date: "2025-05-01", name: "Labour Day" },
  { date: "2025-05-19", name: "Atatürk, Youth & Sports Day" },
  { date: "2025-06-06", name: "Kurban Bayramı" },
  { date: "2025-06-07", name: "Kurban Bayramı" },
  { date: "2025-06-08", name: "Kurban Bayramı" },
  { date: "2025-06-09", name: "Kurban Bayramı" },
  { date: "2025-07-15", name: "Democracy & National Unity Day" },
  { date: "2025-08-30", name: "Victory Day" },
  { date: "2025-10-29", name: "Republic Day" },
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-03-20", name: "Ramazan Bayramı" },
  { date: "2026-03-21", name: "Ramazan Bayramı" },
  { date: "2026-03-22", name: "Ramazan Bayramı" },
  { date: "2026-04-23", name: "National Sovereignty & Children's Day" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-19", name: "Atatürk, Youth & Sports Day" },
  { date: "2026-05-27", name: "Kurban Bayramı" },
  { date: "2026-05-28", name: "Kurban Bayramı" },
  { date: "2026-05-29", name: "Kurban Bayramı" },
  { date: "2026-05-30", name: "Kurban Bayramı" },
  { date: "2026-07-15", name: "Democracy & National Unity Day" },
  { date: "2026-08-30", name: "Victory Day" },
  { date: "2026-10-29", name: "Republic Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-03-10", name: "Ramazan Bayramı" },
  { date: "2027-03-11", name: "Ramazan Bayramı" },
  { date: "2027-03-12", name: "Ramazan Bayramı" },
  { date: "2027-04-23", name: "National Sovereignty & Children's Day" },
  { date: "2027-05-01", name: "Labour Day" },
  { date: "2027-05-16", name: "Kurban Bayramı" },
  { date: "2027-05-17", name: "Kurban Bayramı" },
  { date: "2027-05-18", name: "Kurban Bayramı" },
  { date: "2027-05-19", name: "Atatürk, Youth & Sports Day" },
  { date: "2027-07-15", name: "Democracy & National Unity Day" },
  { date: "2027-08-30", name: "Victory Day" },
  { date: "2027-10-29", name: "Republic Day" },
];

export const list = query({
  args: { year: v.optional(v.number()) },
  handler: async (ctx, { year }) => {
    await requireProfile(ctx);
    const rows =
      year !== undefined
        ? await ctx.db
            .query("holidays")
            .withIndex("by_year", (q) => q.eq("year", year))
            .collect()
        : await ctx.db.query("holidays").collect();
    return rows.map((r) => ({ ...r, country: countryOf(r.country) }));
  },
});

// Holidays overlapping a window. Scoped to the acting user's country for the
// request-form preview; pass country to override.
export const inRange = query({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
    asUserId: v.optional(v.id("users")),
    country: v.optional(v.string()),
  },
  handler: async (ctx, { fromDate, toDate, asUserId, country }) => {
    const { profile } = await resolveViewedProfile(ctx, asUserId);
    const target = country ?? profile.country ?? "IE";
    const all = await ctx.db.query("holidays").collect();
    return all
      .filter(
        (h) =>
          h.date >= fromDate &&
          h.date <= toDate &&
          countryOf(h.country) === target,
      )
      .map((h) => ({ ...h, country: countryOf(h.country) }));
  },
});

// All holidays overlapping a window across every country, for the team
// calendar (labels carry the country).
export const inRangeAll = query({
  args: { fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, { fromDate, toDate }) => {
    await requireProfile(ctx);
    const all = await ctx.db.query("holidays").collect();
    return all
      .filter((h) => h.date >= fromDate && h.date <= toDate)
      .map((h) => ({ ...h, country: countryOf(h.country) }));
  },
});

// Seed one country's holidays for a single year (defaults to the current year).
// We deliberately load just one year at a time so the list stays focused on the
// year being managed rather than dumping several years at once.
async function seedSet(
  ctx: any,
  data: { date: string; name: string }[],
  country: string,
  year: number,
) {
  const actor = await requireSuperadmin(ctx);
  const existing = new Set(
    (await ctx.db.query("holidays").collect()).map(
      (h: any) => `${countryOf(h.country)}:${h.date}`,
    ),
  );
  let added = 0;
  for (const h of data) {
    if (yearOf(h.date) !== year) continue;
    if (existing.has(`${country}:${h.date}`)) continue;
    await ctx.db.insert("holidays", {
      date: h.date,
      name: h.name,
      year: yearOf(h.date),
      country,
    });
    added++;
  }
  if (added > 0) {
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "holidays.seeded",
      entityType: "holiday",
      entityName: `${country} holidays ${year} (${added} added)`,
    });
  }
  return { added };
}

export const seedIrish = mutation({
  args: { year: v.optional(v.number()) },
  handler: async (ctx, { year }) =>
    seedSet(ctx, IRISH_HOLIDAYS, "IE", year ?? new Date().getUTCFullYear()),
});

export const seedTurkish = mutation({
  args: { year: v.optional(v.number()) },
  handler: async (ctx, { year }) =>
    seedSet(ctx, TURKISH_HOLIDAYS, "TR", year ?? new Date().getUTCFullYear()),
});

export const add = mutation({
  args: { date: v.string(), name: v.string(), country: v.string() },
  handler: async (ctx, { date, name, country }) => {
    const actor = await requireSuperadmin(ctx);
    const id = await ctx.db.insert("holidays", {
      date,
      name,
      year: yearOf(date),
      country,
    });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "holiday.added",
      entityType: "holiday",
      entityId: id,
      entityName: `${name} (${date}, ${country})`,
    });
    return id;
  },
});

// Idempotent bulk insert used by the Nager import. Internal: only callable
// from server code (the action below), never directly from the client.
export const bulkInsert = internalMutation({
  args: {
    rows: v.array(
      v.object({
        date: v.string(),
        name: v.string(),
        year: v.number(),
        country: v.string(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const existing = new Set(
      (await ctx.db.query("holidays").collect()).map(
        (h) => `${countryOf(h.country)}:${h.date}`,
      ),
    );
    let added = 0;
    for (const r of rows) {
      const key = `${r.country}:${r.date}`;
      if (existing.has(key)) continue;
      existing.add(key);
      await ctx.db.insert("holidays", {
        date: r.date,
        name: r.name,
        year: r.year,
        country: r.country,
      });
      added++;
    }
    return { added };
  },
});

// Download public holidays for a country from the free Nager.Date API and
// store them. fetch runs in Convex's default runtime, so this needs no
// "use node". Skips countries/years Nager doesn't cover (returns 0) and only
// keeps nationwide (global) holidays, not regional ones.
export const importFromNager = action({
  args: { country: v.string(), years: v.array(v.number()) },
  handler: async (ctx, { country, years }): Promise<{ added: number }> => {
    const me = await ctx.runQuery(api.users.me, {});
    if (!me || (me.role !== "admin" && me.role !== "superadmin")) {
      throw new ConvexError("Admins only.");
    }
    const code = country.trim().toUpperCase();
    const rows: {
      date: string;
      name: string;
      year: number;
      country: string;
    }[] = [];
    for (const year of years) {
      const res = await fetch(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`,
      );
      if (!res.ok) continue; // not covered for this country/year
      const data = (await res.json()) as Array<{
        date: string;
        name: string;
        localName: string;
        global: boolean;
      }>;
      for (const h of data) {
        if (h.global === false) continue; // skip regional-only holidays
        rows.push({ date: h.date, name: h.name, year, country: code });
      }
    }
    if (rows.length === 0) return { added: 0 };
    return await ctx.runMutation(internal.holidays.bulkInsert, { rows });
  },
});

// Cron target: download the CURRENT year's public holidays for every configured
// country from Nager. Runs Jan 1 so each new year self-populates. No auth (it's
// internal, only callable by the scheduler). Idempotent via bulkInsert.
export const importYearForAllCountries = internalAction({
  args: {},
  handler: async (ctx): Promise<{ year: number; added: number }> => {
    const year = new Date().getUTCFullYear();
    const codes: string[] = await ctx.runQuery(internal.countries.listCodes, {});
    let added = 0;
    for (const code of codes) {
      const res = await fetch(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`,
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Array<{
        date: string;
        name: string;
        global: boolean;
      }>;
      const rows = data
        .filter((h) => h.global !== false)
        .map((h) => ({ date: h.date, name: h.name, year, country: code }));
      if (rows.length === 0) continue;
      const r = await ctx.runMutation(internal.holidays.bulkInsert, { rows });
      added += r.added;
    }
    return { year, added };
  },
});

export const remove = mutation({
  args: { holidayId: v.id("holidays") },
  handler: async (ctx, { holidayId }) => {
    const actor = await requireSuperadmin(ctx);
    const h = await ctx.db.get(holidayId);
    await ctx.db.delete(holidayId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "holiday.removed",
      entityType: "holiday",
      entityId: holidayId,
      entityName: h ? `${h.name} (${h.date})` : undefined,
    });
  },
});
