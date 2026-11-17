import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import {
  resolveActingProfile,
  canApprove,
  isSuperadmin,
  resolveApprover,
} from "./model";

// Years that actually have approved leave (role-scoped like approvedLeave),
// for the report's year picker — no made-up future/empty years. The current
// year is always included so there's a sensible default before any data.
export const years = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(me.role)) return [];

    const allProfiles = await ctx.db.query("profiles").collect();
    let teamUserIds: Set<string> | null = null;
    if (!isSuperadmin(me.role)) {
      teamUserIds = new Set();
      for (const p of allProfiles) {
        if ((await resolveApprover(ctx, p)) === me.userId) {
          teamUserIds.add(p.userId);
        }
      }
    }

    const approved = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const set = new Set<number>([new Date().getUTCFullYear()]);
    for (const r of approved) {
      if (teamUserIds === null || teamUserIds.has(r.userId)) {
        set.add(Number(r.startDate.slice(0, 4)));
      }
    }
    return [...set].sort((a, b) => b - a);
  },
});

// Approved leave taken in a given year, for reporting and CSV export.
// Approvers only, and scoped to the people they approve for unless they're a
// superadmin.
export const approvedLeave = query({
  args: { year: v.number(), asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { year, asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(me.role)) throw new ConvexError("Not authorized.");
    const yearPrefix = String(year);

    const allProfiles = await ctx.db.query("profiles").collect();
    // Only superadmins see the whole company; admins and office managers are
    // limited to the people they approve for.
    let teamUserIds: Set<string> | null = null;
    if (!isSuperadmin(me.role)) {
      teamUserIds = new Set();
      for (const p of allProfiles) {
        if ((await resolveApprover(ctx, p)) === me.userId) {
          teamUserIds.add(p.userId);
        }
      }
    }

    const approved = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const rows = approved.filter(
      (r) =>
        r.startDate.startsWith(yearPrefix) &&
        (teamUserIds === null || teamUserIds.has(r.userId)),
    );

    const types = await ctx.db.query("leaveTypes").collect();
    const typeById = new Map(
      types.map((t: Doc<"leaveTypes">) => [t._id, t]),
    );
    const profByUser = new Map(
      allProfiles.map((p: Doc<"profiles">) => [p.userId, p]),
    );
    const deptById = new Map(
      (await ctx.db.query("departments").collect()).map((d) => [d._id, d.name]),
    );

    const detail = rows
      .map((r) => {
        const prof = profByUser.get(r.userId);
        return {
          employeeName: prof?.name ?? "Unknown",
          department:
            prof?.departmentId && deptById.get(prof.departmentId)
              ? deptById.get(prof.departmentId)!
              : "—",
          leaveType: typeById.get(r.leaveTypeId)?.name ?? "Unknown",
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days,
          approvedBy: r.decidedBy
            ? (profByUser.get(r.decidedBy)?.name ?? "—")
            : "—",
        };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Per-person totals across all leave types.
    const totals = new Map<string, number>();
    for (const d of detail) {
      totals.set(d.employeeName, (totals.get(d.employeeName) ?? 0) + d.days);
    }
    const summary = [...totals.entries()]
      .map(([employeeName, days]) => ({ employeeName, days }))
      .sort((a, b) => b.days - a.days);

    return { detail, summary, totalDays: detail.reduce((s, d) => s + d.days, 0) };
  },
});
