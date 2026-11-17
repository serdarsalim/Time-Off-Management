import { query, mutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  requireProfile,
  getProfileByUserId,
  resolveActingProfile,
} from "./model";

// Insert an in-app notification for a recipient, honoring their in-app
// preference (on unless explicitly disabled). Safe no-op if disabled.
export async function notify(
  ctx: MutationCtx,
  recipientUserId: Id<"users">,
  args: {
    type: string;
    title: string;
    body?: string;
    requestId?: Id<"leaveRequests">;
  },
) {
  const profile = await getProfileByUserId(ctx, recipientUserId);
  if (profile && profile.notifyInApp === false) return;
  await ctx.db.insert("notifications", {
    recipientUserId,
    type: args.type,
    title: args.title,
    body: args.body,
    requestId: args.requestId,
    createdAt: Date.now(),
  });
}

// The acting user's recent notifications (newest first). When an admin is
// impersonating, asUserId surfaces that person's notifications instead.
export const list = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) =>
        q.eq("recipientUserId", profile.userId),
      )
      .order("desc")
      .take(30);
    // Attach the linked request's CURRENT status, so a "requested leave"
    // notification shows whether it's since been approved/rejected/cancelled.
    return await Promise.all(
      rows.map(async (n) => ({
        ...n,
        requestStatus: n.requestId
          ? ((await ctx.db.get(n.requestId))?.status ?? null)
          : null,
      })),
    );
  },
});

export const unreadCount = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_unread", (q) =>
        q.eq("recipientUserId", profile.userId).eq("readAt", undefined),
      )
      .collect();
    return unread.length;
  },
});

export const markRead = mutation({
  args: {
    notificationId: v.id("notifications"),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { notificationId, asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    const n = await ctx.db.get(notificationId);
    if (!n || n.recipientUserId !== profile.userId) return;
    if (n.readAt) return;
    await ctx.db.patch(notificationId, { readAt: Date.now() });
  },
});

export const markAllRead = mutation({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_unread", (q) =>
        q.eq("recipientUserId", profile.userId).eq("readAt", undefined),
      )
      .collect();
    const now = Date.now();
    for (const n of unread) await ctx.db.patch(n._id, { readAt: now });
  },
});
