import { ConvexError } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  resolveActingProfile,
  resolveApprover,
  getSuperadminUserIds,
  requireTeamAccess,
} from "./model";
import { writeAudit } from "./audit";
import { notify } from "./notifications";
import { formatLateness, formatDay } from "./format";

const MAX_MINUTES = 24 * 60; // a late arrival beyond a full day is a data-entry slip

// Shared by the self-report and the manager-entered paths so the two can't
// drift into accepting different things. Returns the cleaned values.
function checkLateness(date: string, minutes: number, reason: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ConvexError("A valid date is required.");
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date > today) throw new ConvexError("You can't log lateness for a future day.");

  const mins = Math.round(minutes);
  if (!Number.isFinite(mins) || mins <= 0) {
    throw new ConvexError("Enter how late the arrival was.");
  }
  if (mins > MAX_MINUTES) {
    throw new ConvexError("That's more than a full day — check the hours/minutes.");
  }
  const why = reason.trim();
  if (!why) throw new ConvexError("A reason is required.");
  return { mins, why };
}

// Employee records that they got in late on a given day: how many minutes, and
// why. Purely a log — no leave balance, entitlement or approval is touched. The
// person's manager (or the superadmins, if none) gets a bell notification, and
// an email if they've opted in to lateness emails.
export const report = mutation({
  args: {
    date: v.string(),
    minutes: v.number(),
    reason: v.string(),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { date, minutes, reason, asUserId }) => {
    const { profile, caller, impersonating } = await resolveActingProfile(
      ctx,
      asUserId,
    );
    // Admins log their own lateness here too — same as booking leave.
    if (!profile.active) throw new ConvexError("That account is inactive.");
    if (profile.status === "pending" || profile.status === "rejected") {
      throw new ConvexError("This account hasn't been approved yet.");
    }

    const { mins, why } = checkLateness(date, minutes, reason);

    const entryId = await ctx.db.insert("latenessEntries", {
      userId: profile.userId,
      date,
      minutes: mins,
      reason: why,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "lateness.reported",
      entityType: "lateness",
      entityId: entryId,
      entityName: `${profile.name} · ${formatLateness(mins)} late`,
      impersonatedUserId: impersonating ? profile.userId : undefined,
      metadata: { date, minutes: mins },
    });

    // The people who manage this person: their approver plus every superadmin
    // (superadmins manage everyone). Mirrors the lateness-email recipients so
    // the bell and the email always land in the same inboxes.
    const approverId = await resolveApprover(ctx, profile);
    const recipients = new Set<Id<"users">>(await getSuperadminUserIds(ctx));
    if (approverId) recipients.add(approverId);
    recipients.delete(profile.userId); // never notify someone about their own lateness
    for (const rid of recipients) {
      await notify(ctx, rid, {
        type: "lateness.reported",
        title: `${profile.name} logged a late arrival`,
        body: `${formatLateness(mins)} late on ${formatDay(date)} · ${why}`,
      });
    }

    await ctx.scheduler.runAfter(0, internal.email.notifyLateness, {
      entryId,
    });

    return entryId;
  },
});

// A manager recording someone else's late arrival, from that person's profile.
// Not impersonation: the entry is the employee's, but the trail says a manager
// entered it, because "she reported this" and "her manager logged it against
// her" are different facts. Admins can do it for anyone, office managers for
// their own team — the same reach as seeing the log in the first place.
export const logFor = mutation({
  args: {
    userId: v.id("users"),
    date: v.string(),
    minutes: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { userId, date, minutes, reason }) => {
    const caller = await requireTeamAccess(ctx, userId);
    const person = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!person) throw new ConvexError("That person no longer exists.");
    if (!person.active) throw new ConvexError("That account is inactive.");

    const { mins, why } = checkLateness(date, minutes, reason);

    const entryId = await ctx.db.insert("latenessEntries", {
      userId,
      date,
      minutes: mins,
      reason: why,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "lateness.reported",
      entityType: "lateness",
      entityId: entryId,
      entityName: `${person.name} · ${formatLateness(mins)} late`,
      metadata: { date, minutes: mins, enteredByManager: true },
    });

    // Same recipients as a self-report, minus whoever just typed it — they
    // don't need a bell for their own data entry.
    const approverId = await resolveApprover(ctx, person);
    const recipients = new Set<Id<"users">>(await getSuperadminUserIds(ctx));
    if (approverId) recipients.add(approverId);
    recipients.delete(person.userId);
    recipients.delete(caller.userId);
    for (const rid of recipients) {
      await notify(ctx, rid, {
        type: "lateness.reported",
        title: `${caller.name} logged a late arrival for ${person.name}`,
        body: `${formatLateness(mins)} late on ${formatDay(date)} · ${why}`,
      });
    }

    await ctx.scheduler.runAfter(0, internal.email.notifyLateness, { entryId });

    return entryId;
  },
});

// Remove an entry. Same reach as logging one — if you can file a late arrival
// against someone you can take a mistaken one back off them, which matters now
// that managers type these: a typo'd entry would otherwise be permanent. The
// row goes, the audit line stays, so the removal is still answerable.
export const remove = mutation({
  args: { entryId: v.id("latenessEntries") },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) return null;
    const caller = await requireTeamAccess(ctx, entry.userId);
    const person = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", entry.userId))
      .unique();

    await ctx.db.delete(entryId);
    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "lateness.deleted",
      entityType: "lateness",
      entityId: entryId,
      entityName: `${person?.name ?? "Unknown"} · ${formatLateness(entry.minutes)} late`,
      metadata: { date: entry.date, minutes: entry.minutes },
    });
    return null;
  },
});

// The acting user's own late-arrival log (newest first).
export const mine = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    return await ctx.db
      .query("latenessEntries")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .order("desc")
      .collect();
  },
});

// A member's late-arrival log for the manager view. Admins see anyone; office
// managers see only their own team.
export const forUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireTeamAccess(ctx, userId);
    return await ctx.db
      .query("latenessEntries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

// Load an entry, who was late, and every email address to notify — for the
// email action (runs without a user). Recipients are the person's resolved
// approver (direct manager or department approver) plus every superadmin, since
// superadmins manage everyone. Each is gated by their own lateness-email opt-in
// (default OFF); the late person is never emailed about their own arrival.
export const getForEmail = internalQuery({
  args: { entryId: v.id("latenessEntries") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) return null;
    const person = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", entry.userId))
      .unique();

    const approverId = person ? await resolveApprover(ctx, person) : null;
    const superadminIds = await getSuperadminUserIds(ctx);
    const recipientIds = new Set<Id<"users">>(superadminIds);
    if (approverId) recipientIds.add(approverId);
    recipientIds.delete(entry.userId); // never email someone about their own lateness

    const emails: string[] = [];
    for (const uid of recipientIds) {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", uid))
        .unique();
      if (!p || !p.active || !p.email) continue;
      if (p.notifyLatenessEmail !== true) continue; // opt-in only
      emails.push(p.email);
    }

    return {
      entry,
      personName: person?.name ?? "Someone",
      emails,
    };
  },
});
