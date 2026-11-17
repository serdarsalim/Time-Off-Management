import { ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./model";

// Admin: notes about a member, newest first.
export const forMember = query({
  args: { memberUserId: v.id("users") },
  handler: async (ctx, { memberUserId }) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("memberNotes")
      .withIndex("by_member", (q) => q.eq("memberUserId", memberUserId))
      .order("desc")
      .collect();
  },
});

export const add = mutation({
  args: { memberUserId: v.id("users"), body: v.string() },
  handler: async (ctx, { memberUserId, body }) => {
    const actor = await requireAdmin(ctx);
    const text = body.trim();
    if (!text) throw new ConvexError("Note can't be empty.");
    await ctx.db.insert("memberNotes", {
      memberUserId,
      authorUserId: actor.userId,
      authorName: actor.name,
      body: text,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { noteId: v.id("memberNotes") },
  handler: async (ctx, { noteId }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(noteId);
  },
});
