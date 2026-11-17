import { ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  requireProfile,
  requireAdmin,
  resolveApprover,
  resolveActingProfile,
  countLeaveDays,
  getCountryWorkDays,
  getHolidaySet,
  getSuperadminUserIds,
  isAdmin,
  isSuperadmin,
  canApprove,
  canManageUser,
  isOnApproverTeam,
  requireTeamAccess,
  countryOf,
  isAnniversary,
  resolveLeaveProfile,
  leaveProfileOf,
  leavePeriodYearOf,
  currentPeriodYear,
  firstPeriodYear,
  periodBounds,
  addMonthsISO,
  hiddenUserIds,
} from "./model";
import {
  getOrCreateAllowance,
  entitlementParts,
  periodEntitlement,
} from "./allowances";
import { writeAudit } from "./audit";
import { statusValidator } from "./schema";
import { notify } from "./notifications";
import { formatRange } from "./format";

async function decorate(
  ctx: QueryCtx,
  requests: Doc<"leaveRequests">[],
) {
  const types = await ctx.db.query("leaveTypes").collect();
  const typeById = new Map(types.map((t: Doc<"leaveTypes">) => [t._id, t]));
  const profiles = await ctx.db.query("profiles").collect();
  const nameByUser = new Map(
    profiles.map((p: Doc<"profiles">) => [p.userId, p.name]),
  );
  const countryByUser = new Map(
    profiles.map((p: Doc<"profiles">) => [p.userId, countryOf(p.country)]),
  );
  return await Promise.all(
    requests.map(async (r) => ({
      ...r,
      leaveTypeName: typeById.get(r.leaveTypeId)?.name ?? "Unknown",
      leaveTypeColor: typeById.get(r.leaveTypeId)?.color ?? "#9ca3af",
      employeeName: nameByUser.get(r.userId) ?? "Unknown",
      employeeCountry: countryByUser.get(r.userId) ?? "IE",
      approvedByName: r.decidedBy
        ? (nameByUser.get(r.decidedBy) ?? null)
        : null,
      // Short-lived signed URL for the attached document, if any.
      documentUrl: r.documentId ? await ctx.storage.getUrl(r.documentId) : null,
    })),
  );
}

// What a decision would do to the applicant's balance, for the leave types
// that keep one. Pending days aren't charged until approval, so `before` is
// where the person stands right now and `after` is what the approver is about
// to commit them to. Both can go negative: running out of allowance no longer
// blocks a booking, so the approver is the one deciding whether the overdraft
// is acceptable.
async function balanceImpact(ctx: QueryCtx, requests: Doc<"leaveRequests">[]) {
  const lpByUser = new Map<
    Id<"users">,
    Awaited<ReturnType<typeof leaveProfileOf>>
  >();
  const out = new Map<
    Id<"leaveRequests">,
    { before: number; after: number } | null
  >();
  for (const r of requests) {
    // A row with a live amendment is judged on the proposed dates; anything
    // else on its own.
    const useProposed = hasPendingAmendment(r);
    const leaveType = await ctx.db.get(r.leaveTypeId);
    if (!leaveType?.deductsAllowance) {
      out.set(r._id, null);
      continue;
    }
    let lp = lpByUser.get(r.userId);
    if (!lp) {
      const applicant = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", r.userId))
        .unique();
      lp = await leaveProfileOf(ctx, applicant);
      lpByUser.set(r.userId, lp);
    }
    const startDate = useProposed
      ? (r.proposedStartDate ?? r.startDate)
      : r.startDate;
    const periodYear = leavePeriodYearOf(startDate, lp);
    const row = await ctx.db
      .query("allowances")
      .withIndex("by_user_type_year", (q) =>
        q
          .eq("userId", r.userId)
          .eq("leaveTypeId", r.leaveTypeId)
          .eq("year", periodYear),
      )
      .unique();
    const base = periodEntitlement(
      leaveType,
      lp,
      periodYear,
      periodBounds(periodYear, lp),
      r.leaveTypeId === lp.annualLeaveTypeId,
    );
    const before = entitlementParts(row, base).totalDays - (row?.usedDays ?? 0);
    // An amendment's original days are already charged if the leave was
    // approved, so hand them back before charging the proposal — changing 5
    // days to 6 costs one more day, not six.
    const credit =
      useProposed &&
      r.status === "approved" &&
      leavePeriodYearOf(r.startDate, lp) === periodYear
        ? r.days
        : 0;
    const days = useProposed ? (r.proposedDays ?? r.days) : r.days;
    out.set(r._id, { before, after: before + credit - days });
  }
  return out;
}

// Upload target for a supporting document (e.g. a sick cert). The client
// POSTs the file here, then passes the returned storageId into request /
// adminCreate as documentId.
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireProfile(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

const STATUS_LABEL: Record<string, string> = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
};

// Shared validation + working-day computation for creating a leave row —
// used by the employee `request` flow and by admin direct entry. Throws on
// anything invalid; returns the computed day count and the leave type.
async function prepareLeave(
  ctx: MutationCtx,
  profile: Doc<"profiles">,
  args: {
    leaveTypeId: Id<"leaveTypes">;
    startDate: string;
    endDate: string;
    startHalf?: boolean;
    endHalf?: boolean;
  },
  // Admin entry skips the first-year lock — an admin entering early statutory
  // leave is deliberately granting an exception. Nothing here gates on the
  // balance: leave that runs past the entitlement books anyway and the balance
  // goes negative. `excludeRequestId` is set when editing an existing row:
  // it's allowed to overlap the dates it already occupies.
  opts: { enforceFirstYearLock: boolean; excludeRequestId?: Id<"leaveRequests"> },
) {
  const { leaveTypeId, startDate, endDate, startHalf, endHalf } = args;
  const holidays = await getHolidaySet(
    ctx,
    startDate,
    endDate,
    profile.country ?? "IE",
  );
  const workDays = await getCountryWorkDays(ctx, profile.country);
  const days = countLeaveDays(
    startDate,
    endDate,
    holidays,
    startHalf,
    endHalf,
    workDays,
  );
  if (days === 0) {
    throw new ConvexError(
      "That range has no working days (weekends and public holidays don't count).",
    );
  }

  const leaveType = await ctx.db.get(leaveTypeId);
  if (!leaveType || !leaveType.active) {
    throw new ConvexError("Unknown leave type.");
  }
  // Leave types are country-scoped — you can only book your own country's.
  if (countryOf(leaveType.countryCode) !== countryOf(profile.country)) {
    throw new ConvexError("That leave type isn't available for this country.");
  }

  // The country's leave-year rule (calendar vs anniversary + tiers/lock).
  const lp = await resolveLeaveProfile(ctx, profile.country, profile.startDate);
  const isStatutoryAnnual = leaveType._id === lp.annualLeaveTypeId;

  // Block overlap with the person's own pending or approved leave.
  const active = await ctx.db
    .query("leaveRequests")
    .withIndex("by_user", (q) => q.eq("userId", profile.userId))
    .collect();
  const clash = active.find(
    (r) =>
      r._id !== opts.excludeRequestId &&
      (r.status === "pending" || r.status === "approved") &&
      r.startDate <= endDate &&
      r.endDate >= startDate,
  );
  if (clash) {
    throw new ConvexError(
      `That overlaps existing leave (${clash.startDate} to ${clash.endDate}).`,
    );
  }

  // First-year rule (anniversary mode only): the statutory annual type is
  // locked for the first few months of the first period (Türkiye's 6-month
  // rule). Only applies when the country has the rule switched on.
  if (
    opts.enforceFirstYearLock &&
    lp.firstYearRule &&
    isAnniversary(lp) &&
    isStatutoryAnnual &&
    profile.startDate
  ) {
    const periodYear = leavePeriodYearOf(startDate, lp);
    const first = firstPeriodYear(lp);
    if (first !== null && periodYear === first) {
      const months = lp.lockMonths ?? 6;
      const unlock = addMonthsISO(profile.startDate, months);
      if (startDate < unlock) {
        const unlockLabel = new Date(`${unlock}T00:00:00Z`).toLocaleDateString(
          "en-GB",
          { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
        );
        throw new ConvexError(
          `${leaveType.name} unlocks after your first ${months} months — you can book it from ${unlockLabel}.`,
        );
      }
    }
  }

  return { days, leaveType, lp };
}

// Employee books leave. Computes working days and emails the approver. Running
// out of allowance doesn't stop the booking — the balance goes negative and the
// approver decides.
export const request = mutation({
  args: {
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
    startHalf: v.optional(v.boolean()),
    endHalf: v.optional(v.boolean()),
    halfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    documentId: v.optional(v.id("_storage")),
    documentName: v.optional(v.string()),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (
    ctx,
    {
      leaveTypeId,
      startDate,
      endDate,
      note,
      startHalf,
      endHalf,
      halfPeriod,
      documentId,
      documentName,
      asUserId,
    },
  ) => {
    const { profile, caller, impersonating } = await resolveActingProfile(
      ctx,
      asUserId,
    );
    // Admins are staff too: they book their own leave here like anyone else.
    // It routes to their own approver, so it's only self-approvable when they
    // are that approver (or a superadmin, who can decide anything).
    if (!profile.active) throw new ConvexError("That account is inactive.");
    if (profile.status === "pending" || profile.status === "rejected") {
      throw new ConvexError("This account hasn't been approved yet.");
    }

    const single = startDate === endDate;
    const { days, leaveType } = await prepareLeave(
      ctx,
      profile,
      {
        leaveTypeId,
        startDate,
        endDate,
        startHalf,
        endHalf: single ? undefined : endHalf,
      },
      { enforceFirstYearLock: true },
    );

    const requestId = await ctx.db.insert("leaveRequests", {
      userId: profile.userId,
      leaveTypeId,
      startDate,
      endDate,
      days,
      status: "pending",
      note,
      startHalf: startHalf || undefined,
      endHalf: single ? undefined : endHalf || undefined,
      halfPeriod: single && startHalf ? halfPeriod : undefined,
      // A document only sticks when the type allows one.
      documentId: leaveType.allowDoc ? documentId : undefined,
      documentName:
        leaveType.allowDoc && documentId ? documentName : undefined,
    });

    const leaveTypeDoc = leaveType;
    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "leave.requested",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${profile.name} · ${leaveTypeDoc?.name ?? "Leave"}`,
      impersonatedUserId: impersonating ? profile.userId : undefined,
      metadata: { startDate, endDate, days },
    });

    const approverId = await resolveApprover(ctx, profile);

    // Bell notification to the assigned approver. With nobody assigned it
    // falls to the superadmins rather than every admin — an admin only hears
    // about the people they approve for, but the request still can't vanish.
    const recipients = approverId
      ? [approverId]
      : await getSuperadminUserIds(ctx);
    for (const rid of recipients) {
      if (rid === profile.userId) continue;
      await notify(ctx, rid, {
        type: "leave.requested",
        title: `${profile.name} requested leave`,
        body: `${leaveTypeDoc?.name ?? "Leave"} · ${formatRange(startDate, endDate)} (${days}d)`,
        requestId,
      });
    }

    await ctx.scheduler.runAfter(0, internal.email.notifyRequest, {
      requestId,
      approverId: approverId ?? undefined,
    });

    return requestId;
  },
});

// Employee amends their own request while it's still pending. Nothing has
// been decided yet, so there's nothing to re-approve — the row is rewritten
// in place and stays pending. Approved leave is deliberately NOT editable
// here: once a manager has agreed to it (and possibly arranged cover), a
// change has to go back through them.
//
// Revalidates from scratch through prepareLeave, so an amendment can't slip
// past the overlap or first-year checks a fresh request faces.
// The one difference is that the row is allowed to overlap itself.
export const editPending = mutation({
  args: {
    requestId: v.id("leaveRequests"),
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
    startHalf: v.optional(v.boolean()),
    endHalf: v.optional(v.boolean()),
    halfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    // Only set when the employee attaches a *new* file. Left undefined, the
    // existing document stays put — reopening the form shouldn't drop the
    // sick cert someone already uploaded.
    documentId: v.optional(v.id("_storage")),
    documentName: v.optional(v.string()),
    asUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      requestId,
      leaveTypeId,
      startDate,
      endDate,
      note,
      startHalf,
      endHalf,
      halfPeriod,
      documentId,
      documentName,
      asUserId,
    },
  ) => {
    const { profile, caller, impersonating } = await resolveActingProfile(
      ctx,
      asUserId,
    );
    if (!profile.active) throw new ConvexError("That account is inactive.");

    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found.");
    if (request.userId !== profile.userId && !isAdmin(caller.role)) {
      throw new ConvexError("That is not your request.");
    }
    if (request.status !== "pending") {
      throw new ConvexError(
        `That request has already been ${STATUS_LABEL[request.status] ?? request.status} — it can't be amended.`,
      );
    }
    if (endDate < startDate) {
      throw new ConvexError("The end date can't be before the start date.");
    }

    const single = startDate === endDate;
    const { days, leaveType } = await prepareLeave(
      ctx,
      profile,
      {
        leaveTypeId,
        startDate,
        endDate,
        startHalf,
        endHalf: single ? undefined : endHalf,
      },
      { enforceFirstYearLock: true, excludeRequestId: requestId },
    );

    // Keep whatever document is already attached unless a new one came with
    // the edit — but drop it if the type changed to one that doesn't take
    // documents, so a stale cert can't hang off an annual leave row.
    const keptDocument = documentId
      ? { documentId, documentName }
      : { documentId: request.documentId, documentName: request.documentName };
    const doc = leaveType.allowDoc
      ? keptDocument
      : { documentId: undefined, documentName: undefined };

    const wasRange = formatRange(request.startDate, request.endDate);
    const wasDays = request.days;

    await ctx.db.patch(requestId, {
      leaveTypeId,
      startDate,
      endDate,
      days,
      note,
      startHalf: startHalf || undefined,
      endHalf: single ? undefined : endHalf || undefined,
      halfPeriod: single && startHalf ? halfPeriod : undefined,
      ...doc,
    });

    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "leave.edited",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${profile.name} · ${leaveType.name}`,
      impersonatedUserId: impersonating ? profile.userId : undefined,
      metadata: { startDate, endDate, days },
    });

    // Tell the approver it moved. Someone may already have the old dates in
    // their head (or half-written into a rota), so the notification leads
    // with what it was, not just what it now is. The type stays
    // `leave.requested` because that's what routes the bell to /approvals,
    // and an amended request still needs deciding there.
    const approverId = await resolveApprover(ctx, profile);
    const recipients = approverId
      ? [approverId]
      : await getSuperadminUserIds(ctx);
    for (const rid of recipients) {
      if (rid === profile.userId) continue;
      await notify(ctx, rid, {
        type: "leave.requested",
        title: `${profile.name} amended a leave request`,
        body: `${leaveType.name} · was ${wasRange} (${wasDays}d), now ${formatRange(startDate, endDate)} (${days}d)`,
        requestId,
      });
    }

    await ctx.scheduler.runAfter(0, internal.email.notifyRequest, {
      requestId,
      approverId: approverId ?? undefined,
    });

    return null;
  },
});

// Admin enters leave directly for an employee — lands as APPROVED, no
// approval round-trip. Same validation as a request (working days, overlap),
// except the first-year lock: an admin entering statutory leave early is
// deliberately granting an exception. The employee is notified.
export const adminCreate = mutation({
  args: {
    userId: v.id("users"),
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
    startHalf: v.optional(v.boolean()),
    endHalf: v.optional(v.boolean()),
    halfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    documentId: v.optional(v.id("_storage")),
    documentName: v.optional(v.string()),
  },
  returns: v.id("leaveRequests"),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) throw new ConvexError("Person not found.");
    if (!profile.active) throw new ConvexError("That account is inactive.");
    // Entering approved leave IS approving it, so it follows the same reach:
    // superadmins anyone, admins the people they approve for.
    if (!(await canManageUser(ctx, admin, args.userId))) {
      throw new ConvexError("You can only add leave for people you approve for.");
    }

    const { userId, leaveTypeId, startDate, endDate, note, halfPeriod } = args;
    const single = startDate === endDate;
    const startHalf = args.startHalf || undefined;
    const endHalf = single ? undefined : args.endHalf || undefined;

    const { days, leaveType, lp } = await prepareLeave(
      ctx,
      profile,
      { leaveTypeId, startDate, endDate, startHalf, endHalf },
      { enforceFirstYearLock: false },
    );

    const requestId = await ctx.db.insert("leaveRequests", {
      userId,
      leaveTypeId,
      startDate,
      endDate,
      days,
      status: "approved",
      note,
      startHalf,
      endHalf,
      halfPeriod: single && startHalf ? halfPeriod : undefined,
      documentId: leaveType.allowDoc ? args.documentId : undefined,
      documentName:
        leaveType.allowDoc && args.documentId ? args.documentName : undefined,
      decidedBy: admin.userId,
      decidedAt: Date.now(),
      decisionNote: "Entered by admin",
    });

    if (leaveType.deductsAllowance) {
      const allowance = await getOrCreateAllowance(
        ctx,
        userId,
        leaveTypeId,
        leavePeriodYearOf(startDate, lp),
      );
      await ctx.db.patch(allowance._id, {
        usedDays: allowance.usedDays + days,
      });
    }

    await writeAudit(ctx, {
      actorUserId: admin.userId,
      action: "leave.admin_entered",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${profile.name} · ${leaveType.name}`,
      metadata: { startDate, endDate, days },
    });
    await notify(ctx, userId, {
      type: "leave.approved",
      title: `${admin.name} added leave for you`,
      body: `${leaveType.name} · ${formatRange(startDate, endDate)} (${days}d)`,
      requestId,
    });
    await ctx.scheduler.runAfter(0, internal.email.notifyDecision, {
      requestId,
    });

    return requestId;
  },
});

async function loadDecidableRequest(
  ctx: MutationCtx,
  requestId: Id<"leaveRequests">,
  approver: Doc<"profiles">,
) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new ConvexError("Request not found.");
  if (request.status !== "pending") {
    throw new ConvexError("This request is no longer pending.");
  }
  await assertCanDecide(ctx, request, approver);
  return request;
}

// Superadmins can decide anything; admins and office managers only requests
// where they are the assigned approver.
async function assertCanDecide(
  ctx: MutationCtx,
  request: Doc<"leaveRequests">,
  approver: Doc<"profiles">,
) {
  if (isSuperadmin(approver.role)) return;
  const applicant = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", request.userId))
    .unique();
  const theirApprover = applicant ? await resolveApprover(ctx, applicant) : null;
  if (theirApprover !== approver.userId) {
    throw new ConvexError("You are not the approver for this request.");
  }
}

export const approve = mutation({
  args: { requestId: v.id("leaveRequests"), decisionNote: v.optional(v.string()) },
  handler: async (ctx, { requestId, decisionNote }) => {
    const approver = await requireProfile(ctx);
    if (!canApprove(approver.role)) throw new ConvexError("Not authorized.");
    const request = await loadDecidableRequest(ctx, requestId, approver);

    const applicant = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();

    const leaveType = await ctx.db.get(request.leaveTypeId);
    if (leaveType?.deductsAllowance) {
      const lp = await leaveProfileOf(ctx, applicant);
      const allowance = await getOrCreateAllowance(
        ctx,
        request.userId,
        request.leaveTypeId,
        leavePeriodYearOf(request.startDate, lp),
      );
      await ctx.db.patch(allowance._id, {
        usedDays: allowance.usedDays + request.days,
      });
    }

    await ctx.db.patch(requestId, {
      status: "approved",
      decidedBy: approver.userId,
      decidedAt: Date.now(),
      decisionNote,
    });
    await writeAudit(ctx, {
      actorUserId: approver.userId,
      action: "leave.approved",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${applicant?.name ?? "Unknown"} · ${request.startDate}→${request.endDate}`,
    });
    await notify(ctx, request.userId, {
      type: "leave.approved",
      title: "Your leave was approved",
      body: `${leaveType?.name ?? "Leave"} · ${formatRange(request.startDate, request.endDate)}`,
      requestId,
    });

    await ctx.scheduler.runAfter(0, internal.email.notifyDecision, {
      requestId,
    });
  },
});

export const reject = mutation({
  args: { requestId: v.id("leaveRequests"), decisionNote: v.optional(v.string()) },
  handler: async (ctx, { requestId, decisionNote }) => {
    const approver = await requireProfile(ctx);
    if (!canApprove(approver.role)) throw new ConvexError("Not authorized.");
    const request = await loadDecidableRequest(ctx, requestId, approver);

    await ctx.db.patch(requestId, {
      status: "rejected",
      decidedBy: approver.userId,
      decidedAt: Date.now(),
      decisionNote,
    });

    const applicant = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();
    await writeAudit(ctx, {
      actorUserId: approver.userId,
      action: "leave.rejected",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${applicant?.name ?? "Unknown"} · ${request.startDate}→${request.endDate}`,
    });
    await notify(ctx, request.userId, {
      type: "leave.rejected",
      title: "Your leave was rejected",
      body: formatRange(request.startDate, request.endDate),
      requestId,
    });

    await ctx.scheduler.runAfter(0, internal.email.notifyDecision, {
      requestId,
    });
  },
});

// Recount a request's working days for a new range, against the person's own
// country calendar, and check the range is clear of their other live leave.
// Shared by the admin `revise` path and by employee amendments, so a date
// change is validated the same way whoever initiates it.
async function recountRange(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    applicant: Doc<"profiles"> | null;
    // The row being changed — allowed to overlap the dates it already holds.
    excludeRequestId: Id<"leaveRequests">;
    startDate: string;
    endDate: string;
    startHalf?: boolean;
    endHalf?: boolean;
  },
) {
  const { startDate, endDate, applicant } = args;
  if (endDate < startDate) {
    throw new ConvexError("The end date can't be before the start date.");
  }
  const single = startDate === endDate;
  const startHalf = args.startHalf;
  const endHalf = single ? undefined : args.endHalf;

  const holidays = await getHolidaySet(
    ctx,
    startDate,
    endDate,
    applicant?.country ?? "IE",
  );
  const workDays = await getCountryWorkDays(ctx, applicant?.country);
  const days = countLeaveDays(
    startDate,
    endDate,
    holidays,
    startHalf,
    endHalf,
    workDays,
  );
  if (days === 0) {
    throw new ConvexError(
      "That range has no working days (weekends and public holidays don't count).",
    );
  }

  const others = await ctx.db
    .query("leaveRequests")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  const clash = others.find(
    (r) =>
      r._id !== args.excludeRequestId &&
      (r.status === "pending" || r.status === "approved") &&
      r.startDate <= endDate &&
      r.endDate >= startDate,
  );
  if (clash) {
    throw new ConvexError(
      `That overlaps leave from ${clash.startDate} to ${clash.endDate}.`,
    );
  }
  return { days, startHalf, endHalf };
}

type ChargeState = { status: string; days: number; startDate: string };

// Move days between allowance periods when a request changes. Only `approved`
// consumes allowance, so model it as "days charged before" versus "days
// charged after" — a status flip, a date move, or both at once all settle
// correctly, including a move that lands in a different leave year.
async function settleAllowance(
  ctx: MutationCtx,
  args: {
    applicant: Doc<"profiles"> | null;
    userId: Id<"users">;
    leaveTypeId: Id<"leaveTypes">;
    leaveType: Doc<"leaveTypes"> | null;
    before: ChargeState;
    after: ChargeState;
  },
) {
  if (!args.leaveType?.deductsAllowance) return;
  const lp = await leaveProfileOf(ctx, args.applicant);
  const before = args.before.status === "approved" ? args.before.days : 0;
  const after = args.after.status === "approved" ? args.after.days : 0;
  const beforeYear = leavePeriodYearOf(args.before.startDate, lp);
  const afterYear = leavePeriodYearOf(args.after.startDate, lp);

  if (beforeYear === afterYear) {
    if (before === after) return;
    const row = await getOrCreateAllowance(
      ctx,
      args.userId,
      args.leaveTypeId,
      afterYear,
    );
    await ctx.db.patch(row._id, {
      usedDays: Math.max(0, row.usedDays - before + after),
    });
    return;
  }
  if (before > 0) {
    const old = await getOrCreateAllowance(
      ctx,
      args.userId,
      args.leaveTypeId,
      beforeYear,
    );
    await ctx.db.patch(old._id, {
      usedDays: Math.max(0, old.usedDays - before),
    });
  }
  if (after > 0) {
    const next = await getOrCreateAllowance(
      ctx,
      args.userId,
      args.leaveTypeId,
      afterYear,
    );
    await ctx.db.patch(next._id, { usedDays: next.usedDays + after });
  }
}

// Everything that identifies a live amendment proposal on a row.
function hasPendingAmendment(r: Doc<"leaveRequests">): boolean {
  return r.amendmentStatus === "pending" && !!r.proposedStartDate;
}

// Wipe every proposal field. Used when an amendment is applied, withdrawn, or
// the underlying request is cancelled out from under it.
const CLEARED_AMENDMENT = {
  proposedStartDate: undefined,
  proposedEndDate: undefined,
  proposedStartHalf: undefined,
  proposedEndHalf: undefined,
  proposedHalfPeriod: undefined,
  proposedDays: undefined,
  proposedReason: undefined,
  amendmentStatus: undefined,
  amendmentRequestedAt: undefined,
} as const;

// Change the outcome of a request that was already decided — the "I approved
// that by mistake" path. Scope matches approve/reject: superadmins may revise
// anyone's, everyone else only their own team's.
//
// Two things happen beyond the status flip. The allowance ledger is corrected
// in both directions, since leaving `approved` has to hand the days back and
// entering it has to take them; without that, balances drift silently. And the
// change is written to the person's admin notes, so the next manager to open
// the profile can see what was done, by whom, and why.
export const revise = mutation({
  args: {
    requestId: v.id("leaveRequests"),
    status: statusValidator,
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    // Half-day flags, same meaning as on the request itself. Omitted means
    // "leave whatever the request already has alone" — a status-only change
    // shouldn't quietly turn someone's half day into a full one.
    startHalf: v.optional(v.boolean()),
    endHalf: v.optional(v.boolean()),
    halfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { requestId, status, startDate, endDate, reason } = args;
    // Admins and superadmins only — office managers can decide pending leave
    // but not rewrite a settled one, and the trail this leaves lands in the
    // member notes they don't have access to anyway.
    const actor = await requireProfile(ctx);
    if (!isAdmin(actor.role)) throw new ConvexError("Not authorized.");
    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found.");
    await assertCanDecide(ctx, request, actor);

    const applicant = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();
    const leaveType = await ctx.db.get(request.leaveTypeId);

    const nextStart = startDate?.trim() || request.startDate;
    const nextEnd = endDate?.trim() || request.endDate;
    if (nextEnd < nextStart) {
      throw new ConvexError("The end date can't be before the start date.");
    }
    const single = nextStart === nextEnd;

    // A single day can't have a "last day" half — collapsing an admin's range
    // down to one date drops the end flag rather than double-counting it.
    const wantStartHalf = args.startHalf ?? request.startHalf ?? false;
    const wantEndHalf = single ? false : (args.endHalf ?? request.endHalf ?? false);
    const wantHalfPeriod =
      single && wantStartHalf
        ? (args.halfPeriod ?? request.halfPeriod)
        : undefined;

    const datesMoved =
      nextStart !== request.startDate || nextEnd !== request.endDate;
    const halvesChanged =
      wantStartHalf !== (request.startHalf ?? false) ||
      wantEndHalf !== (request.endHalf ?? false) ||
      wantHalfPeriod !== request.halfPeriod;
    if (!datesMoved && !halvesChanged && request.status === status) return;

    // Re-count working days against the person's own country calendar, the
    // same way the original request did — an admin moving dates shouldn't
    // have to know which days are holidays there. Toggling a half-day changes
    // the count too, so it takes the same path.
    let nextDays = request.days;
    let nextStartHalf: boolean | undefined = wantStartHalf;
    let nextEndHalf: boolean | undefined = wantEndHalf;
    if (datesMoved || halvesChanged) {
      const counted = await recountRange(ctx, {
        userId: request.userId,
        applicant,
        excludeRequestId: requestId,
        startDate: nextStart,
        endDate: nextEnd,
        startHalf: wantStartHalf,
        endHalf: wantEndHalf,
      });
      nextDays = counted.days;
      nextStartHalf = counted.startHalf;
      nextEndHalf = counted.endHalf;
    }

    await settleAllowance(ctx, {
      applicant,
      userId: request.userId,
      leaveTypeId: request.leaveTypeId,
      leaveType,
      before: {
        status: request.status,
        days: request.days,
        startDate: request.startDate,
      },
      after: { status, days: nextDays, startDate: nextStart },
    });

    const trimmedReason = reason?.trim();
    await ctx.db.patch(requestId, {
      status,
      startDate: nextStart,
      endDate: nextEnd,
      days: nextDays,
      startHalf: nextStartHalf || undefined,
      endHalf: nextEndHalf || undefined,
      halfPeriod: wantHalfPeriod,
      decidedBy: actor.userId,
      decidedAt: Date.now(),
      decisionNote: trimmedReason || request.decisionNote,
      // An admin rewriting the row settles any amendment sitting on it — the
      // proposal was against dates that no longer exist.
      ...CLEARED_AMENDMENT,
    });

    const range = formatRange(nextStart, nextEnd);
    const wasRange = formatRange(request.startDate, request.endDate);
    // One sentence covering both kinds of edit, so the note reads the same
    // whether the dates moved, the outcome changed, or both. The day count
    // carries any half-day on its own — "1.5d" needs no further explaining.
    const summary =
      `${actor.name} changed ${leaveType?.name ?? "leave"} — ` +
      `${wasRange} (${request.days}d), ${STATUS_LABEL[request.status]} → ` +
      `${range} (${nextDays}d), ${STATUS_LABEL[status]}.`;
    await ctx.db.insert("memberNotes", {
      memberUserId: request.userId,
      authorUserId: actor.userId,
      authorName: actor.name,
      body: trimmedReason ? `${summary} Reason: ${trimmedReason}` : summary,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "leave.revised",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${applicant?.name ?? "Unknown"} · ${request.startDate}→${request.endDate} · ${request.status}→${status}`,
    });

    // Deliberately silent — no in-app notification, no email. Corrections are
    // an admin housekeeping act; the employee sees the new status next time
    // they look, and the admin tells them if it warrants telling.
  },
});

// Employee proposes new dates for leave that is already APPROVED. The
// original row is left exactly as it is — still approved, still on the
// calendar, still charged to their balance — and the proposal rides alongside
// it until an approver decides. That's the whole point: a manager may have
// arranged cover around those dates, so nobody's own booking can quietly move
// out from under them.
//
// This is the path for "I'll come in on the Friday after all". Cancelling
// instead would refund every day including the ones already taken.
export const requestAmendment = mutation({
  args: {
    requestId: v.id("leaveRequests"),
    startDate: v.string(),
    endDate: v.string(),
    startHalf: v.optional(v.boolean()),
    endHalf: v.optional(v.boolean()),
    halfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    reason: v.string(),
    asUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { requestId, startDate, endDate, startHalf, endHalf, halfPeriod, reason, asUserId },
  ) => {
    const { profile, caller, impersonating } = await resolveActingProfile(
      ctx,
      asUserId,
    );
    if (!profile.active) throw new ConvexError("That account is inactive.");

    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found.");
    if (request.userId !== profile.userId && !isAdmin(caller.role)) {
      throw new ConvexError("That is not your request.");
    }
    if (request.status === "pending") {
      throw new ConvexError(
        "This request hasn't been decided yet — edit it directly instead.",
      );
    }
    if (request.status !== "approved") {
      throw new ConvexError(
        `That request was ${STATUS_LABEL[request.status] ?? request.status} — there's nothing to amend.`,
      );
    }
    if (hasPendingAmendment(request)) {
      throw new ConvexError(
        "There's already an amendment waiting on your approver. Withdraw it first.",
      );
    }

    // Leave that has finished is a payroll conversation, not a self-service
    // one — someone retroactively turning last month's annual leave into sick
    // leave is exactly the change that needs an admin. Mid-leave is fine:
    // that's the case this whole feature exists for.
    const today = new Date().toISOString().slice(0, 10);
    if (request.endDate < today) {
      throw new ConvexError(
        "That leave has already finished — ask an admin to correct it.",
      );
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new ConvexError("Say why you need the change.");
    }
    if (startDate === request.startDate && endDate === request.endDate) {
      throw new ConvexError("Those are the dates you already have.");
    }

    const applicant = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();
    const leaveType = await ctx.db.get(request.leaveTypeId);

    const counted = await recountRange(ctx, {
      userId: request.userId,
      applicant,
      excludeRequestId: requestId,
      startDate,
      endDate,
      startHalf,
      endHalf,
    });

    const single = startDate === endDate;
    await ctx.db.patch(requestId, {
      proposedStartDate: startDate,
      proposedEndDate: endDate,
      proposedStartHalf: counted.startHalf || undefined,
      proposedEndHalf: counted.endHalf || undefined,
      proposedHalfPeriod: single && counted.startHalf ? halfPeriod : undefined,
      proposedDays: counted.days,
      proposedReason: trimmedReason,
      amendmentStatus: "pending",
      amendmentRequestedAt: Date.now(),
      // A fresh proposal supersedes an earlier declined one.
      amendmentDecidedBy: undefined,
      amendmentDecidedAt: undefined,
      amendmentDecisionNote: undefined,
    });

    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "leave.amendmentRequested",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${profile.name} · ${request.startDate}→${request.endDate} ⇒ ${startDate}→${endDate}`,
      impersonatedUserId: impersonating ? profile.userId : undefined,
      metadata: { startDate, endDate, days: counted.days },
    });

    const approverId = await resolveApprover(ctx, profile);
    const recipients = approverId
      ? [approverId]
      : await getSuperadminUserIds(ctx);
    for (const rid of recipients) {
      if (rid === profile.userId) continue;
      await notify(ctx, rid, {
        type: "leave.amendment",
        title: `${profile.name} wants to change approved leave`,
        body: `${leaveType?.name ?? "Leave"} · ${formatRange(request.startDate, request.endDate)} (${request.days}d) → ${formatRange(startDate, endDate)} (${counted.days}d)`,
        requestId,
      });
    }

    await ctx.scheduler.runAfter(0, internal.email.notifyAmendment, {
      requestId,
      approverId: approverId ?? undefined,
    });

    return null;
  },
});

// Employee takes the proposal back. The original approved leave is untouched
// throughout, so there's nothing to unwind — just clear the fields.
export const withdrawAmendment = mutation({
  args: {
    requestId: v.id("leaveRequests"),
    asUserId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { requestId, asUserId }) => {
    const { profile, caller, impersonating } = await resolveActingProfile(
      ctx,
      asUserId,
    );
    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found.");
    if (request.userId !== profile.userId && !isAdmin(caller.role)) {
      throw new ConvexError("That is not your request.");
    }
    if (!hasPendingAmendment(request)) return null;

    const wasProposed = formatRange(
      request.proposedStartDate!,
      request.proposedEndDate!,
    );
    await ctx.db.patch(requestId, CLEARED_AMENDMENT);

    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "leave.amendmentWithdrawn",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${profile.name} · ${wasProposed}`,
      impersonatedUserId: impersonating ? profile.userId : undefined,
    });

    // Bell only, no email — "never mind" doesn't warrant landing in an inbox,
    // but an approver who saw the request needs to know it's gone.
    const approverId = await resolveApprover(ctx, profile);
    const recipients = approverId
      ? [approverId]
      : await getSuperadminUserIds(ctx);
    for (const rid of recipients) {
      if (rid === profile.userId) continue;
      await notify(ctx, rid, {
        type: "leave.amendment",
        title: `${profile.name} withdrew an amendment`,
        body: `${formatRange(request.startDate, request.endDate)} stands as approved.`,
        requestId,
      });
    }

    return null;
  },
});

// Approver decides an amendment. Approving folds the proposed dates into the
// real ones and settles the difference on the ledger — five days becoming
// four hands back one day, not five. Declining leaves the original leave
// exactly as it was and keeps the declined proposal on the row so the
// employee can see what happened.
export const decideAmendment = mutation({
  args: {
    requestId: v.id("leaveRequests"),
    approve: v.boolean(),
    decisionNote: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { requestId, approve, decisionNote }) => {
    const approver = await requireProfile(ctx);
    if (!canApprove(approver.role)) throw new ConvexError("Not authorized.");

    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found.");
    if (!hasPendingAmendment(request)) {
      throw new ConvexError("There's no amendment waiting on this request.");
    }
    await assertCanDecide(ctx, request, approver);

    const applicant = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();
    const leaveType = await ctx.db.get(request.leaveTypeId);
    const note = decisionNote?.trim() || undefined;
    const wasRange = formatRange(request.startDate, request.endDate);

    if (!approve) {
      await ctx.db.patch(requestId, {
        amendmentStatus: "rejected",
        amendmentDecidedBy: approver.userId,
        amendmentDecidedAt: Date.now(),
        amendmentDecisionNote: note,
      });
      await writeAudit(ctx, {
        actorUserId: approver.userId,
        action: "leave.amendmentRejected",
        entityType: "leaveRequest",
        entityId: requestId,
        entityName: `${applicant?.name ?? "Unknown"} · ${wasRange}`,
      });
      await notify(ctx, request.userId, {
        type: "leave.amendment.decided",
        title: "Your amendment was declined",
        body: `${leaveType?.name ?? "Leave"} · ${wasRange} stands as approved.`,
        requestId,
      });
      await ctx.scheduler.runAfter(0, internal.email.notifyAmendmentDecision, {
        requestId,
      });
      return null;
    }

    const nextStart = request.proposedStartDate!;
    const nextEnd = request.proposedEndDate!;
    // Recounted rather than trusting proposedDays: holidays or the person's
    // working week can change between asking and deciding.
    const counted = await recountRange(ctx, {
      userId: request.userId,
      applicant,
      excludeRequestId: requestId,
      startDate: nextStart,
      endDate: nextEnd,
      startHalf: request.proposedStartHalf,
      endHalf: request.proposedEndHalf,
    });
    await settleAllowance(ctx, {
      applicant,
      userId: request.userId,
      leaveTypeId: request.leaveTypeId,
      leaveType,
      before: {
        status: request.status,
        days: request.days,
        startDate: request.startDate,
      },
      after: {
        status: request.status,
        days: counted.days,
        startDate: nextStart,
      },
    });

    const single = nextStart === nextEnd;
    await ctx.db.patch(requestId, {
      startDate: nextStart,
      endDate: nextEnd,
      days: counted.days,
      startHalf: counted.startHalf || undefined,
      endHalf: counted.endHalf || undefined,
      halfPeriod:
        single && counted.startHalf ? request.proposedHalfPeriod : undefined,
      // decidedBy/decidedAt stay as they were — that records who approved the
      // leave itself, which is still true.
      amendmentDecidedBy: approver.userId,
      amendmentDecidedAt: Date.now(),
      amendmentDecisionNote: note,
      ...CLEARED_AMENDMENT,
    });

    await writeAudit(ctx, {
      actorUserId: approver.userId,
      action: "leave.amendmentApproved",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${applicant?.name ?? "Unknown"} · ${wasRange} ⇒ ${formatRange(nextStart, nextEnd)}`,
      metadata: { startDate: nextStart, endDate: nextEnd, days: counted.days },
    });
    await notify(ctx, request.userId, {
      type: "leave.amendment.decided",
      title: "Your amendment was approved",
      body: `${leaveType?.name ?? "Leave"} · now ${formatRange(nextStart, nextEnd)} (${counted.days}d)`,
      requestId,
    });
    await ctx.scheduler.runAfter(0, internal.email.notifyAmendmentDecision, {
      requestId,
    });

    return null;
  },
});

// Amendments waiting on the acting user's decision. Same scoping as
// pendingApprovals: superadmins see everything, everyone else their own team.
export const pendingAmendments = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile: approver } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(approver.role)) return [];
    const waiting = await ctx.db
      .query("leaveRequests")
      .withIndex("by_amendment_status", (q) => q.eq("amendmentStatus", "pending"))
      .collect();
    const scoped = isSuperadmin(approver.role)
      ? waiting
      : (
          await Promise.all(
            waiting.map(async (r) =>
              (await isOnApproverTeam(ctx, approver, r.userId)) ? r : null,
            ),
          )
        ).filter((r): r is NonNullable<typeof r> => r !== null);
    const impact = await balanceImpact(ctx, scoped);
    return (await decorate(ctx, scoped)).map((r) => ({
      ...r,
      balance: impact.get(r._id) ?? null,
    }));
  },
});

// Cancel a request. The owner (or an admin acting as them) can cancel.
// Approved leave refunds the allowance.
export const cancel = mutation({
  args: { requestId: v.id("leaveRequests"), asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { requestId, asUserId }) => {
    const { profile, caller, impersonating } = await resolveActingProfile(
      ctx,
      asUserId,
    );
    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found.");
    if (request.userId !== profile.userId && !isAdmin(caller.role)) {
      throw new ConvexError("That is not your request.");
    }
    if (request.status === "cancelled" || request.status === "rejected") {
      return;
    }

    // Cancelling refunds the whole request, so once approved leave has begun
    // it's the wrong verb: on day 4 of 5 it would hand back all five days and
    // record that the leave never happened. Amend it instead — that settles
    // the difference. Admins get pointed at `revise`, which does the same
    // arithmetic and can still land on "cancelled" if that's genuinely right.
    const today = new Date().toISOString().slice(0, 10);
    if (request.status === "approved" && request.startDate <= today) {
      throw new ConvexError(
        isAdmin(caller.role)
          ? "That leave has already started — revise it from the employee's profile so the balance settles correctly."
          : "That leave has already started — request an amendment instead, so only the days you don't take come back.",
      );
    }

    const owner = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();
    if (request.status === "approved") {
      const leaveType = await ctx.db.get(request.leaveTypeId);
      if (leaveType?.deductsAllowance) {
        const lp = await leaveProfileOf(ctx, owner);
        const allowance = await getOrCreateAllowance(
          ctx,
          request.userId,
          request.leaveTypeId,
          leavePeriodYearOf(request.startDate, lp),
        );
        await ctx.db.patch(allowance._id, {
          usedDays: Math.max(0, allowance.usedDays - request.days),
        });
      }
    }
    // Any amendment riding on the row goes with it — there's no longer any
    // leave for it to amend.
    await ctx.db.patch(requestId, {
      status: "cancelled",
      ...CLEARED_AMENDMENT,
    });
    await writeAudit(ctx, {
      actorUserId: caller.userId,
      action: "leave.cancelled",
      entityType: "leaveRequest",
      entityId: requestId,
      entityName: `${owner?.name ?? "Unknown"} · ${request.startDate}→${request.endDate}`,
      impersonatedUserId:
        impersonating && request.userId !== caller.userId
          ? request.userId
          : undefined,
    });

    // Tell the approver. Cancelling used to be silent, which meant a manager
    // who'd arranged cover only found out by looking at the calendar.
    const leaveTypeDoc = await ctx.db.get(request.leaveTypeId);
    const approverId = owner ? await resolveApprover(ctx, owner) : null;
    const recipients = approverId
      ? [approverId]
      : await getSuperadminUserIds(ctx);
    for (const rid of recipients) {
      if (rid === request.userId) continue;
      await notify(ctx, rid, {
        type: "leave.cancelled",
        title: `${owner?.name ?? "Someone"} cancelled leave`,
        body: `${leaveTypeDoc?.name ?? "Leave"} · ${formatRange(request.startDate, request.endDate)} (${request.days}d)`,
        requestId,
      });
    }
    await ctx.scheduler.runAfter(0, internal.email.notifyCancellation, {
      requestId,
      approverId: approverId ?? undefined,
    });
  },
});

// Requests for the acting user (self, or an impersonated user), newest first.
export const myRequests = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .order("desc")
      .collect();
    return await decorate(ctx, rows);
  },
});

// A specific member's requests, newest first (member detail view). Admins see
// anyone; office managers see only their own team.
export const requestsForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireTeamAccess(ctx, userId);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return await decorate(ctx, rows);
  },
});

// The same history, cut into the leave periods the days were taken in, newest
// period first. The allowance card only ever shows the period you're in, so on
// the day a cycle rolls over a full year of leave silently stops being counted
// anywhere on the page — this is where a closed cycle stays answerable. Periods
// come from the person's country rule (calendar for IE, employment anniversary
// for TR) and requests are bucketed by start date, the same attribution the
// balances use, so a cycle's total and its rows can't disagree.
export const historyCyclesForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireTeamAccess(ctx, userId);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    // Only rows still waiting on a decision carry a balance impact: it's what
    // the approve buttons on the profile need, and settled history has no
    // decision left to warn about.
    const impact = await balanceImpact(
      ctx,
      rows.filter((r) => r.status === "pending" || hasPendingAmendment(r)),
    );
    const decorated = (await decorate(ctx, rows)).map((r) => ({
      ...r,
      balance: impact.get(r._id) ?? null,
    }));

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const leaveProfile = await leaveProfileOf(ctx, profile);
    const current = currentPeriodYear(leaveProfile);

    const byPeriod = new Map<number, typeof decorated>();
    for (const r of decorated) {
      const periodYear = leavePeriodYearOf(r.startDate, leaveProfile);
      const bucket = byPeriod.get(periodYear);
      if (bucket) bucket.push(r);
      else byPeriod.set(periodYear, [r]);
    }
    // The current period is always present, even with nothing in it. "Nothing
    // booked yet this cycle" is an answer; a missing tab reads as a fault.
    if (!byPeriod.has(current)) byPeriod.set(current, []);

    const types = await ctx.db.query("leaveTypes").collect();
    const typeById = new Map(types.map((t: Doc<"leaveTypes">) => [t._id, t]));

    const cycles = [...byPeriod.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([periodYear, requests]) => {
        const bounds = periodBounds(periodYear, leaveProfile);
        // Only approved days are "taken" — pending, rejected and cancelled
        // rows still list, but they never move a total.
        const daysByType = new Map<Id<"leaveTypes">, number>();
        for (const r of requests) {
          if (r.status !== "approved") continue;
          daysByType.set(
            r.leaveTypeId,
            (daysByType.get(r.leaveTypeId) ?? 0) + r.days,
          );
        }
        const totals = [...daysByType.entries()]
          .map(([leaveTypeId, days]) => ({
            leaveTypeId,
            name: typeById.get(leaveTypeId)?.name ?? "Unknown",
            color: typeById.get(leaveTypeId)?.color ?? "#9ca3af",
            deductsAllowance: typeById.get(leaveTypeId)?.deductsAllowance ?? true,
            days,
          }))
          // Allowance-deducting types lead: "how much annual did they use" is
          // the question a closed cycle gets asked, and unpaid or WFH days can
          // easily out-number it without out-ranking it.
          .sort(
            (a, b) =>
              Number(b.deductsAllowance) - Number(a.deductsAllowance) ||
              b.days - a.days ||
              a.name.localeCompare(b.name),
          );
        return {
          periodYear,
          label: bounds.label,
          startISO: bounds.startISO,
          endISO: bounds.endISO,
          isCurrent: periodYear === current,
          // Imported rows share a creation time, so creation order says
          // nothing about them — order by the leave date instead.
          requests: [...requests].sort((a, b) =>
            b.startDate.localeCompare(a.startDate),
          ),
          totals,
        };
      });

    return { currentPeriodYear: current, cycles };
  },
});

// Everything that ever happened to one leave request, oldest first. Read by the
// expanded row in the leave history so the trail is answerable from the profile
// instead of sending people to the activity log to piece it together.
// Deliberately its own query: collapsed rows cost nothing, and expanding one
// fetches only that request's entries.
export const eventsForRequest = query({
  args: { requestId: v.id("leaveRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request) return [];
    await requireTeamAccess(ctx, request.userId);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_entity", (q) =>
        q.eq("entityType", "leaveRequest").eq("entityId", requestId),
      )
      .collect();
    return rows
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((r) => ({
        _id: r._id,
        action: r.action,
        actorName: r.actorName ?? "Unknown",
        // Set when an admin did this while acting as someone else — worth
        // showing, since "she requested it" and "an admin requested it as her"
        // are different answers to the same question.
        impersonatedName: r.impersonatedName ?? null,
        timestamp: r.timestamp,
        metadata: r.metadata ?? null,
      }));
  },
});

// Pending requests this person is allowed to decide on. Superadmins see every
// pending request; admins and office managers see only their own team's.
export const pendingApprovals = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    // Resolves as the impersonated person when acting as someone, so an
    // admin's view shows their queue, not the impersonator's.
    const { profile: approver } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(approver.role)) return [];
    const pending = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const scoped = isSuperadmin(approver.role)
      ? pending
      : (
          await Promise.all(
            pending.map(async (r) =>
              (await isOnApproverTeam(ctx, approver, r.userId)) ? r : null,
            ),
          )
        ).filter((r): r is NonNullable<typeof r> => r !== null);
    const impact = await balanceImpact(ctx, scoped);
    return (await decorate(ctx, scoped)).map((r) => ({
      ...r,
      balance: impact.get(r._id) ?? null,
    }));
  },
});

// Who's on approved leave today, scoped by role for the dashboard:
// superadmins see everyone, admins and office managers see only the people
// they approve for, others get nothing.
export const offTodayScoped = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(me.role)) return [];
    const today = new Date().toISOString().slice(0, 10);
    const approved = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const hidden = await hiddenUserIds(ctx);
    let overlapping = approved.filter(
      (r) =>
        r.startDate <= today && r.endDate >= today && !hidden.has(r.userId),
    );
    if (!isSuperadmin(me.role)) {
      overlapping = (
        await Promise.all(
          overlapping.map(async (r) =>
            (await isOnApproverTeam(ctx, me, r.userId)) ? r : null,
          ),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null);
    }
    return await decorate(ctx, overlapping);
  },
});

// Approved leave overlapping a window, for the team calendar. The team
// calendar is limited to approvers (admins, superadmins, office managers) —
// regular employees don't get a company-wide view of who's off.
//
// `teamOnly` narrows the result to the people the caller approves for. The
// dashboard passes it (an admin's figures are about their own remit); the
// calendar page doesn't, so the company-wide view stays company-wide.
export const calendar = query({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
    teamOnly: v.optional(v.boolean()),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { fromDate, toDate, teamOnly, asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(me.role)) throw new ConvexError("Not allowed.");
    const approved = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const hidden = await hiddenUserIds(ctx);
    let overlapping = approved.filter(
      (r) =>
        r.startDate <= toDate && r.endDate >= fromDate && !hidden.has(r.userId),
    );
    if (teamOnly && !isSuperadmin(me.role)) {
      overlapping = (
        await Promise.all(
          overlapping.map(async (r) =>
            (await isOnApproverTeam(ctx, me, r.userId)) ? r : null,
          ),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null);
    }
    const rows = await decorate(ctx, overlapping);
    // The calendar is a coverage view — who's off, and when. Superadmins get
    // profile lookup on top of that; for everyone else the names stay plain
    // text, rather than some being clickable and some not.
    const canOpen = isSuperadmin(me.role);
    return rows.map((r) => ({ ...r, canOpen }));
  },
});

// Approved leave for the team calendar, visible to every authenticated
// employee: name + dates + country + leave type, so peers can self-coordinate
// ("who's out that week, and is it annual or sick?"). The free-text note is
// withheld — that's where the personal reason lives. Approvers use `calendar`
// above for the full-detail view including notes.
//
// Scope is driven by the org-wide `calendarScope` setting (Settings →
// configuration): "company" (the default) shows everyone's approved leave;
// "department" narrows an employee to their own department. In department
// mode, anyone without a department assigned falls back to the company-wide
// view (scoping them to an empty set would just hand them a blank calendar).
// Note the mirror effect: an employee who has no department also doesn't
// appear on anyone else's department calendar — only approvers see them.
export const calendarPublic = query({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
    asUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { fromDate, toDate, asUserId }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    const approved = await ctx.db
      .query("leaveRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const hidden = await hiddenUserIds(ctx);
    const overlapping = approved.filter(
      (r) =>
        r.startDate <= toDate && r.endDate >= fromDate && !hidden.has(r.userId),
    );
    const profiles = await ctx.db.query("profiles").collect();
    const nameByUser = new Map(
      profiles.map((p: Doc<"profiles">) => [p.userId, p.name]),
    );
    const countryByUser = new Map(
      profiles.map((p: Doc<"profiles">) => [p.userId, countryOf(p.country)]),
    );
    const deptByUser = new Map(
      profiles.map((p: Doc<"profiles">) => [p.userId, p.departmentId]),
    );
    const types = await ctx.db.query("leaveTypes").collect();
    const typeById = new Map(types.map((t: Doc<"leaveTypes">) => [t._id, t]));
    // Scope per the org setting; in department mode, unassigned viewers see
    // everyone.
    const settings = await ctx.db.query("orgSettings").first();
    const scope = settings?.calendarScope ?? "company";
    const scoped =
      scope === "department" && me.departmentId
        ? overlapping.filter(
            (r) => deptByUser.get(r.userId) === me.departmentId,
          )
        : overlapping;
    return scoped.map((r) => ({
      _id: r._id,
      startDate: r.startDate,
      endDate: r.endDate,
      employeeName: nameByUser.get(r.userId) ?? "Unknown",
      employeeCountry: countryByUser.get(r.userId) ?? "IE",
      // The leave TYPE is shared (peers can see it's annual vs sick); the
      // free-text note stays withheld — that's the part that carries the
      // personal reason.
      leaveTypeName: typeById.get(r.leaveTypeId)?.name ?? "Leave",
      leaveTypeColor: typeById.get(r.leaveTypeId)?.color ?? "#9ca3af",
    }));
  },
});

// Used by the email action to load a request without auth.
export const getForEmail = internalQuery({
  args: { requestId: v.id("leaveRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request) return null;
    const applicant = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", request.userId))
      .unique();
    const leaveType = await ctx.db.get(request.leaveTypeId);
    let approverEmail: string | null = null;
    if (request.decidedBy) {
      const dp = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", request.decidedBy!))
        .unique();
      approverEmail = dp?.email ?? null;
    }
    return {
      request,
      applicantName: applicant?.name ?? "Unknown",
      applicantEmail: applicant?.email ?? null,
      applicantNotifyEmail: applicant?.notifyEmail !== false,
      leaveTypeName: leaveType?.name ?? "Leave",
      approverEmail,
    };
  },
});

// Email helper: resolve a userId to their email + email preference.
export const emailForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!p) return null;
    return { email: p.email, notifyEmail: p.notifyEmail !== false };
  },
});
