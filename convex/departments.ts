import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireProfile, requireAdmin } from "./model";
import { writeAudit } from "./audit";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireProfile(ctx);
    return await ctx.db.query("departments").collect();
  },
});

// Rich per-department view for the Departments tab: headcount, who's on leave
// today, the assigned approver (office manager), and upcoming leave. Includes
// an "unassigned" bucket for active people with no department.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const departments = await ctx.db.query("departments").collect();
    const profiles = await ctx.db.query("profiles").collect();
    const nameByUser = new Map(profiles.map((p) => [p.userId, p.name]));
    const approved = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    function statsFor(memberIds: Set<string>) {
      const offNow = approved
        .filter(
          (r) =>
            memberIds.has(r.userId) &&
            r.startDate <= today &&
            r.endDate >= today,
        )
        .map((r) => ({
          userId: r.userId,
          name: nameByUser.get(r.userId) ?? "Unknown",
          endDate: r.endDate,
        }));
      const upcoming = approved
        .filter(
          (r) =>
            memberIds.has(r.userId) &&
            r.startDate > today &&
            r.startDate <= horizon,
        )
        .map((r) => ({
          userId: r.userId,
          name: nameByUser.get(r.userId) ?? "Unknown",
          startDate: r.startDate,
          endDate: r.endDate,
        }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { offNow, upcoming };
    }

    const rows = departments
      .map((d) => {
        const members = profiles.filter(
          (p) => p.departmentId === d._id && p.active && !p.hiddenFromRoster,
        );
        const memberIds = new Set(members.map((p) => p.userId));
        return {
          _id: d._id,
          name: d.name,
          approverId: d.approverId ?? null,
          approverName: d.approverId
            ? (nameByUser.get(d.approverId) ?? null)
            : null,
          headcount: members.length,
          ...statsFor(memberIds),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const unassigned = profiles.filter(
      (p) =>
        !p.departmentId &&
        p.active &&
        (p.role === "member" || p.role === "office_manager"),
    );
    const unassignedIds = new Set(unassigned.map((p) => p.userId));

    return {
      departments: rows,
      unassigned: {
        headcount: unassigned.length,
        ...statsFor(unassignedIds),
      },
    };
  },
});

export const create = mutation({
  args: { name: v.string(), approverId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const id = await ctx.db.insert("departments", args);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "department.created",
      entityType: "department",
      entityId: id,
      entityName: args.name,
    });
    return id;
  },
});

export const rename = mutation({
  args: { departmentId: v.id("departments"), name: v.string() },
  handler: async (ctx, { departmentId, name }) => {
    await requireAdmin(ctx);
    const n = name.trim();
    if (!n) return;
    await ctx.db.patch(departmentId, { name: n });
  },
});

export const remove = mutation({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    const actor = await requireAdmin(ctx);
    const dept = await ctx.db.get(departmentId);
    // Unlink any members assigned to this department.
    const affected = await ctx.db
      .query("profiles")
      .withIndex("by_department", (q) => q.eq("departmentId", departmentId))
      .collect();
    for (const p of affected) {
      await ctx.db.patch(p._id, { departmentId: undefined });
    }
    await ctx.db.delete(departmentId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "department.removed",
      entityType: "department",
      entityId: departmentId,
      entityName: dept?.name,
    });
  },
});

export const setApprover = mutation({
  args: { departmentId: v.id("departments"), approverId: v.id("users") },
  handler: async (ctx, { departmentId, approverId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(departmentId, { approverId });
  },
});
