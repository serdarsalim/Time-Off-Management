import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Permission tier. `superadmin` does everything an admin can plus manages
// other admins/superadmins. `admin` manages people/settings and approves
// leave. `office_manager` books their own leave AND approves their own team
// (no other management). `member` books their own leave.
export const roleValidator = v.union(
  v.literal("superadmin"),
  v.literal("admin"),
  v.literal("office_manager"),
  v.literal("member"),
);

export const statusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("cancelled"),
);

export default defineSchema({
  // Convex Auth tables (users, authAccounts, authSessions, ...).
  ...authTables,

  // Per-person profile layered on top of the auth `users` table.
  profiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: roleValidator,
    // Keep this person out of every shared view — team calendar, who's off
    // today, headcount, office presence, department rosters. They stay a
    // normal employee otherwise, and stay findable in the employee list so an
    // approver can undo it. For accounts that belong to the company rather
    // than to a colleague.
    hiddenFromRoster: v.optional(v.boolean()),
    // Approval gate for new members. Legacy/undefined counts as "active".
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("active"),
        v.literal("rejected"),
      ),
    ),
    // Job title / role in the company (e.g. "Recruiter"). Distinct from the
    // permission `role` above.
    title: v.optional(v.string()),
    // The `departments` table + departmentId are surfaced as "Office" in the
    // UI — they drive approver routing. Kept under the legacy `department`
    // name internally to avoid a table migration.
    departmentId: v.optional(v.id("departments")),
    // Optional functional department / team (e.g. "Engineering"), shown as
    // "Department" in the UI. A free-text label — no approver routing.
    team: v.optional(v.string()),
    // Direct approver. Falls back to the office (department) approver when unset.
    managerId: v.optional(v.id("users")),
    active: v.boolean(),
    // Sign-in revoked without offboarding: they stay an active employee who
    // counts in headcount and whose leave an admin can still enter — they just
    // can't log in. Unset = allowed.
    signInBlocked: v.optional(v.boolean()),
    // Notification preferences. Treated as true when unset.
    notifyEmail: v.optional(v.boolean()),
    notifyInApp: v.optional(v.boolean()),
    // Separate opt-IN for late-arrival emails (approvers only). Unlike the
    // general email pref, this defaults OFF — a manager gets the bell for a
    // team member's late arrival, and only emails if they switch this on.
    notifyLatenessEmail: v.optional(v.boolean()),
    // Country the person works in — drives which public holidays apply.
    // "IE" (Ireland) or "TR" (Türkiye). Treated as "IE" when unset.
    country: v.optional(v.string()),
    // Employment start date (YYYY-MM-DD). Annual leave in the joining year is
    // pro-rated from this date. Unset (legacy members) = full entitlement.
    startDate: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_department", ["departmentId"])
    .index("by_email", ["email"]),

  departments: defineTable({
    name: v.string(),
    // Default approver for everyone in the department.
    approverId: v.optional(v.id("users")),
  }),

  // Functional departments/teams (e.g. "Sales"), surfaced as "Department" in
  // the UI — pure labels with no approver routing (that's `departments`,
  // surfaced as "Office"). Profiles reference these by NAME via `profiles.team`,
  // not by id, so renaming/removing a team here doesn't rewrite people.
  teams: defineTable({
    name: v.string(),
  }),

  // Company-wide app settings. A single row, created lazily on first write;
  // every field is optional and code supplies the default when unset.
  orgSettings: defineTable({
    // Whose approved leave employees see on the team calendar (names only —
    // the leave type/reason is always withheld from non-approvers):
    //   "company"    — everyone in the company.
    //   "department" — only people in the viewer's own department.
    // Unset → "company".
    calendarScope: v.optional(
      v.union(v.literal("company"), v.literal("department")),
    ),
  }),

  // Countries the company operates in. Seeded with IE + TR but fully
  // data-driven: admins add/remove countries from settings. `leaveYearMode`
  // selects one of the code-supported leave-year behaviours:
  //   "calendar"    — Jan–Dec year, joining year pro-rated (Ireland).
  //   "anniversary" — employment-anniversary year with tiered entitlement and
  //                   a first-period lock (Türkiye).
  // A genuinely new rule needs a new mode in code; everything else is data.
  countries: defineTable({
    code: v.string(), // uppercase ISO-ish code, e.g. "IE"
    name: v.string(),
    leaveYearMode: v.union(
      v.literal("calendar"),
      v.literal("anniversary"),
    ),
    active: v.boolean(),
    // annualLeaveTypeId designates which leave type is this country's statutory
    // annual one (its days/yr is the entitlement). Optional "first-year rule":
    // when firstYearRule is on, the statutory type grants firstYearDays in the
    // joining period instead of pro-rating, and (anniversary mode only)
    // lockMonths gates how soon it can be taken. annualDays is legacy/unused.
    annualLeaveTypeId: v.optional(v.id("leaveTypes")),
    firstYearRule: v.optional(v.boolean()),
    firstYearDays: v.optional(v.number()),
    annualDays: v.optional(v.number()),
    lockMonths: v.optional(v.number()),
    // Legacy: an old "dashboard columns" approach stored curated leave-type ids
    // here. That feature moved to per-admin prefs, but existing country rows
    // still carry the field. Declared optional so those rows validate; safe to
    // drop once the data is migrated clean.
    dashboardLeaveTypeIds: v.optional(v.array(v.id("leaveTypes"))),
    // Working weekdays for this country, as day indices 0=Sun … 6=Sat. Days
    // not listed (typically Sat/Sun) are non-working: they render differently
    // in the calendar and don't count against leave. Unset → Mon–Fri.
    workDays: v.optional(v.array(v.number())),
  }).index("by_code", ["code"]),

  // Audit trail of meaningful actions. Actor/entity display names are frozen
  // at write time so a later rename doesn't rewrite history. searchText powers
  // the activity-log search.
  auditLog: defineTable({
    actorUserId: v.optional(v.id("users")),
    actorName: v.optional(v.string()),
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    entityName: v.optional(v.string()),
    // Set when the actor performed this while impersonating someone.
    impersonatedUserId: v.optional(v.id("users")),
    impersonatedName: v.optional(v.string()),
    metadata: v.optional(v.any()),
    searchText: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_actor", ["actorUserId"])
    // Lets one record pull its own trail without scanning the whole log —
    // what the expandable leave-history rows read.
    .index("by_entity", ["entityType", "entityId"])
    .searchIndex("search", { searchField: "searchText" }),

  // In-app (bell) notifications, one row per recipient.
  notifications: defineTable({
    recipientUserId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    requestId: v.optional(v.id("leaveRequests")),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_recipient", ["recipientUserId", "createdAt"])
    .index("by_recipient_unread", ["recipientUserId", "readAt"]),

  // Company-wide non-working days. Excluded from leave working-day counts
  // and shown on the team calendar.
  holidays: defineTable({
    date: v.string(), // ISO "2026-12-25"
    name: v.string(),
    year: v.number(),
    // "IE" or "TR". Treated as "IE" when unset (legacy rows).
    country: v.optional(v.string()),
  })
    .index("by_year", ["year"])
    .index("by_date", ["date"]),

  leaveTypes: defineTable({
    name: v.string(),
    color: v.string(),
    // Each leave type belongs to one country. Legacy rows (no countryCode)
    // are treated as the default country ("IE") until migrated.
    countryCode: v.optional(v.string()),
    // Days granted per person per year for this type. In calendar mode this is
    // the annual entitlement (pro-rated in the joining year). In anniversary
    // mode the statutory annual type's figure comes from the country tiers.
    defaultAllowanceDays: v.number(),
    // Whether requests of this type reduce the yearly allowance.
    deductsAllowance: v.boolean(),
    // Employees may attach a supporting document (e.g. a sick cert) when
    // requesting this type. The upload itself is always optional.
    allowDoc: v.optional(v.boolean()),
    // Whether this type gets its own swatch in the team-calendar legend.
    // Unset → shown. Switch off for types whose colour is already explained
    // by another country's entry (the TR types mirror the IE ones), so the
    // key stays short without hiding the leave itself.
    showInLegend: v.optional(v.boolean()),
    active: v.boolean(),
    // Deprecated — statutory-annual designation and the TR tiers now live on the
    // `countries` record. Kept optional so pre-migration rows still validate.
    isAnnual: v.optional(v.boolean()),
    trFirstYearDays: v.optional(v.number()),
    trAnnualDays: v.optional(v.number()),
    // How many unused days may roll into the next leave period. Only read for
    // the country's statutory PTO type — every other type forfeits its balance
    // at reset. Unset → no carryover.
    carryOverMaxDays: v.optional(v.number()),
    // Display position within the country, low to high. Superadmins set it by
    // dragging in settings; every list of leave types honours it. Unset rows
    // sort last, by creation time, so pre-migration data keeps its old order.
    sortOrder: v.optional(v.number()),
  }).index("by_country", ["countryCode"]),

  // One row per person / leave type / year. Entitlement is additive:
  //
  //   total = base + carriedInDays + extraDays
  //
  // where base is the leave type's live default (pro-rated / tiered), or
  // `overrideDays` when an admin has set one. The override deliberately
  // replaces the base ONLY — so granting someone extra days or rolling their
  // balance forward never quietly redefines the statutory floor they get every
  // year after. Employees only ever see the total; the three components are
  // admin-only. `totalDays` is a legacy field, no longer written.
  allowances: defineTable({
    userId: v.id("users"),
    leaveTypeId: v.id("leaveTypes"),
    year: v.number(),
    totalDays: v.optional(v.number()),
    overrideDays: v.optional(v.number()),
    // Unused days rolled in from the previous period, already capped at the
    // leave type's carryOverMaxDays. Written by the reset job, not by hand.
    carriedInDays: v.optional(v.number()),
    // Days that expired at that same reset because they exceeded the cap.
    // Recorded purely so the allowance card can say what was lost.
    forfeitedDays: v.optional(v.number()),
    // Admin-granted days on top of entitlement — loyalty, negotiated extra.
    // Not carryover, and not part of the statutory base.
    extraDays: v.optional(v.number()),
    // Set once the reset job has rolled a balance into this row, so a re-run
    // (retry, backfill, manual trigger) can't double-apply the carryover.
    carryoverAppliedAt: v.optional(v.number()),
    usedDays: v.number(),
  })
    .index("by_user_year", ["userId", "year"])
    .index("by_user_type_year", ["userId", "leaveTypeId", "year"]),

  // Admin-only freeform notes about a member.
  memberNotes: defineTable({
    memberUserId: v.id("users"),
    authorUserId: v.optional(v.id("users")),
    authorName: v.optional(v.string()),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_member", ["memberUserId", "createdAt"]),

  // Late-arrival log. Deliberately standalone: an employee records that they
  // got in late (how many minutes, and why). It touches NO leave balances,
  // entitlements or approval state — it's an informational log that replaces
  // the "I emailed to say I was late" flow, and notifies the person's manager.
  latenessEntries: defineTable({
    userId: v.id("users"),
    // The working day the person was late, ISO "2026-07-11".
    date: v.string(),
    // How late, in whole minutes (the form collects hours + minutes).
    minutes: v.number(),
    // Why — required, free text.
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "date"]),

  leaveRequests: defineTable({
    userId: v.id("users"),
    leaveTypeId: v.id("leaveTypes"),
    // ISO date strings, inclusive. e.g. "2026-07-01".
    startDate: v.string(),
    endDate: v.string(),
    // Working days requested (excludes weekends/holidays; may be fractional
    // when half-days are used).
    days: v.number(),
    // Half-day flags. For a single-day request, startHalf marks it a half day.
    // For a range, startHalf/endHalf mark the first/last day as half days.
    startHalf: v.optional(v.boolean()),
    endHalf: v.optional(v.boolean()),
    // Which half a single-day half-day covers (display only).
    halfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    status: statusValidator,
    note: v.optional(v.string()),
    // Supporting document (e.g. sick cert), for leave types with allowDoc.
    documentId: v.optional(v.id("_storage")),
    documentName: v.optional(v.string()),
    // Set when a manager approves or rejects.
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),

    // --- Amendment to an already-approved request ---
    // The employee proposes new dates; the fields above stay untouched until
    // an approver agrees. That's the point: the original stays approved and
    // on the calendar, so cover arranged around it isn't silently pulled by
    // someone editing their own booking.
    proposedStartDate: v.optional(v.string()),
    proposedEndDate: v.optional(v.string()),
    proposedStartHalf: v.optional(v.boolean()),
    proposedEndHalf: v.optional(v.boolean()),
    proposedHalfPeriod: v.optional(
      v.union(v.literal("morning"), v.literal("afternoon")),
    ),
    // Working days the proposal comes to, recomputed at decision time.
    proposedDays: v.optional(v.number()),
    // Why they want the change — required, and shown to the approver.
    proposedReason: v.optional(v.string()),
    // "pending" while awaiting a decision; "rejected" keeps the declined
    // proposal visible on the row. An approved amendment clears this and
    // folds the proposed dates into the real ones.
    amendmentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("rejected")),
    ),
    amendmentRequestedAt: v.optional(v.number()),
    amendmentDecidedBy: v.optional(v.id("users")),
    amendmentDecidedAt: v.optional(v.number()),
    amendmentDecisionNote: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_amendment_status", ["amendmentStatus"]),
});
