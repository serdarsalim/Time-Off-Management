import { ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireProfile, requireAdmin } from "./model";
import { writeAudit } from "./audit";

// Functional departments ("Department" in the UI). Profiles store the team
// NAME on `profiles.team`, so these rows are just the pick-list — removing one
// never touches people who already carry the label.

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("teams"),
      _creationTime: v.number(),
      name: v.string(),
    }),
  ),
  handler: async (ctx) => {
    await requireProfile(ctx);
    const rows = await ctx.db.query("teams").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.id("teams"),
  handler: async (ctx, { name }) => {
    const actor = await requireAdmin(ctx);
    const n = name.trim();
    if (!n) throw new ConvexError("Department name is required.");
    const all = await ctx.db.query("teams").collect();
    if (all.some((t) => t.name.toLowerCase() === n.toLowerCase())) {
      throw new ConvexError(`Department "${n}" already exists.`);
    }
    const id = await ctx.db.insert("teams", { name: n });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "team.created",
      entityType: "team",
      entityId: id,
      entityName: n,
    });
    return id;
  },
});

// Renames the pick-list entry AND relabels everyone currently carrying the
// old name, so the directory stays consistent.
export const rename = mutation({
  args: { teamId: v.id("teams"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { teamId, name }) => {
    const actor = await requireAdmin(ctx);
    const team = await ctx.db.get(teamId);
    if (!team) throw new ConvexError("Department not found.");
    const n = name.trim();
    if (!n) throw new ConvexError("Department name is required.");
    await ctx.db.patch(teamId, { name: n });
    const profiles = await ctx.db.query("profiles").collect();
    for (const p of profiles) {
      if (p.team === team.name) await ctx.db.patch(p._id, { team: n });
    }
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "team.renamed",
      entityType: "team",
      entityId: teamId,
      entityName: `${team.name} → ${n}`,
    });
  },
});

export const remove = mutation({
  args: { teamId: v.id("teams") },
  returns: v.null(),
  handler: async (ctx, { teamId }) => {
    const actor = await requireAdmin(ctx);
    const team = await ctx.db.get(teamId);
    if (!team) return;
    const profiles = await ctx.db.query("profiles").collect();
    const inUse = profiles.filter((p) => p.team === team.name).length;
    if (inUse > 0) {
      throw new ConvexError(
        `"${team.name}" is assigned to ${inUse} ${inUse === 1 ? "person" : "people"} — reassign them first.`,
      );
    }
    await ctx.db.delete(teamId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "team.removed",
      entityType: "team",
      entityId: teamId,
      entityName: team.name,
    });
  },
});
