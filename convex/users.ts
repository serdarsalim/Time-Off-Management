import { ConvexError } from "convex/values";
import { query, mutation, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { roleValidator } from "./schema";
import {
  getCurrentProfile,
  requireProfile,
  requireAdmin,
  requireTeamAccess,
  getProfileByUserId,
  isAdmin,
  isSuperadmin,
  isOwner,
  canApprove,
  canManageUser,
  isOnApproverTeam,
  resolveActingProfile,
  periodYearForApproval,
  resolveLeaveProfile,
} from "./model";
import { getOrCreateAllowance, reconcileUsage } from "./allowances";
import { writeAudit } from "./audit";

// The signed-in person's profile, or null if not authenticated. Always the
// REAL caller — impersonation is layered on top client-side via asUserId.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) return null;
    // `isOwner` rides along so the UI can hide owner-only controls rather than
    // offering a button that always errors. The mutation checks it again.
    return { ...profile, isOwner: isOwner(profile) };
  },
});

// A single person by userId — used by the impersonation banner. Admin only.
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireAdmin(ctx);
    const p = await getProfileByUserId(ctx, userId);
    if (!p) return null;
    return {
      userId: p.userId,
      name: p.name,
      email: p.email,
      role: p.role,
      country: p.country ?? "IE",
    };
  },
});

// Lightweight profile summary for the personal dashboard: employment start
// date and department name. Impersonation-aware (admins may pass asUserId).
export const myOverview = query({
  args: { asUserId: v.optional(v.id("users")) },
  handler: async (ctx, { asUserId }) => {
    const { profile } = await resolveActingProfile(ctx, asUserId);
    let departmentName: string | null = null;
    if (profile.departmentId) {
      const dept = await ctx.db.get(profile.departmentId);
      departmentName = dept?.name ?? null;
    }
    return {
      startDate: profile.startDate ?? null,
      departmentName,
    };
  },
});

// New member completes their profile (first/last/phone) after first sign-in.
// Stays pending until an admin approves — the admin sets the start date and
// country at approval time, since those drive the leave entitlement.
export const completeProfile = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, { firstName, lastName, phone }) => {
    const me = await requireProfile(ctx);
    const fn = firstName.trim();
    const ln = lastName.trim();
    const ph = phone.trim();
    if (!fn || !ln || !ph) {
      throw new ConvexError("First name, last name and phone are required.");
    }
    await ctx.db.patch(me._id, {
      firstName: fn,
      lastName: ln,
      phone: ph,
      name: `${fn} ${ln}`,
    });
  },
});

// Admin: approve a pending member so they can use the app. The admin sets the
// start date and country here — both drive how the leave year and entitlement
// are calculated, so they must be correct from the moment the account goes live.
export const approveMember = mutation({
  args: {
    profileId: v.id("profiles"),
    startDate: v.string(),
    country: v.string(),
    // Optional job details set in the approval modal. Omitted = leave as-is.
    title: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    // Optional manual entitlement overrides set in the approval modal. Anything
    // omitted keeps the auto-calculated (country + start-date) entitlement.
    overrides: v.optional(
      v.array(
        v.object({ leaveTypeId: v.id("leaveTypes"), days: v.number() }),
      ),
    ),
  },
  handler: async (
    ctx,
    { profileId, startDate, country, title, departmentId, overrides },
  ) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    const sd = startDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      throw new ConvexError("A valid start date is required to approve.");
    }
    // Validate against the configured countries rather than a hardcoded list.
    const countryRow = await ctx.db
      .query("countries")
      .withIndex("by_code", (q) => q.eq("code", country))
      .unique();
    if (!countryRow || !countryRow.active) {
      throw new ConvexError("A valid country is required to approve.");
    }
    const patch: Partial<Doc<"profiles">> = {
      status: "active",
      startDate: sd,
      country,
    };
    if (title !== undefined) patch.title = title.trim() || undefined;
    if (departmentId !== undefined) patch.departmentId = departmentId;
    await ctx.db.patch(profileId, patch);
    // Approval is usually the FIRST time a start date and country exist. Any
    // leave already on the record (imported history, or booked while they were
    // pending) was filed against a guessed calendar year until now.
    await reconcileUsage(ctx, target.userId);
    // Apply any manual entitlement overrides to the current leave period.
    if (overrides && overrides.length > 0) {
      const lp = await resolveLeaveProfile(ctx, country, sd);
      const periodYear = periodYearForApproval(lp);
      for (const o of overrides) {
        const row = await getOrCreateAllowance(
          ctx,
          target.userId,
          o.leaveTypeId,
          periodYear,
        );
        await ctx.db.patch(row._id, {
          overrideDays: Math.max(0, Math.floor(o.days)),
        });
      }
    }
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "member.approved",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
      metadata: { startDate: sd, country },
    });
  },
});

// Admin: a person signed themselves up while the directory already held a
// record for them, so there are now two of them. This points the sign-up at
// the record that has the history instead of approving a duplicate.
//
// The identity moves rather than the data: the address lands on the existing
// person (whose leave, allowances and notes are all keyed to their userId),
// and the sign-up's Google account and sessions are dropped so her next
// sign-in links to the record we kept. The sign-up profile stays behind,
// emptied and rejected, so the audit trail still shows it existed.
export const matchMember = mutation({
  args: {
    signupProfileId: v.id("profiles"),
    targetUserId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { signupProfileId, targetUserId }) => {
    const actor = await requireAdmin(ctx);
    const signup = await ctx.db.get(signupProfileId);
    if (!signup) throw new ConvexError("That sign-up no longer exists.");
    if (signup.status !== "pending" && signup.status !== "rejected") {
      throw new ConvexError(
        "Only a pending or rejected sign-up can be matched — this account is already live.",
      );
    }
    if (!signup.email) throw new ConvexError("That sign-up has no email left to move.");

    const target = await getProfileByUserId(ctx, targetUserId);
    if (!target) throw new ConvexError("Person not found.");
    if (target.userId === signup.userId) {
      throw new ConvexError("That is the same account.");
    }
    if (target.status === "pending" || target.status === "rejected") {
      throw new ConvexError("Match into an approved person, not another sign-up.");
    }
    if (!(await canManageUser(ctx, actor, targetUserId))) {
      throw new ConvexError("You can only match people you approve for.");
    }

    const email = signup.email;

    // Empty the sign-up first — the address is unique across profiles, so it
    // has to be released before it can be claimed.
    await ctx.db.patch(signup._id, {
      email: "",
      status: "rejected",
      active: false,
    });
    await ctx.db.patch(signup.userId, { email: undefined });

    // Claim it on the record we're keeping. Marking the address verified is
    // what lets her next Google sign-in attach to this user instead of
    // minting a third account.
    await ctx.db.patch(target._id, {
      email,
      phone: target.phone ?? signup.phone,
    });
    await ctx.db.patch(targetUserId, {
      email,
      emailVerificationTime: Date.now(),
    });

    // Drop the sign-up's provider link and any live sessions. Without this the
    // Google account still resolves to the old user and she'd land back on the
    // duplicate on her next login.
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", signup.userId))
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", signup.userId))
      .collect();
    for (const s of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const t of tokens) await ctx.db.delete(t._id);
      await ctx.db.delete(s._id);
    }

    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "member.matched",
      entityType: "user",
      entityId: targetUserId,
      entityName: `${signup.name} (${email}) → ${target.name}`,
    });
  },
});

// Admin: reject a pending sign-up.
export const rejectMember = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    await ctx.db.patch(profileId, { status: "rejected" });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "member.rejected",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
    });
  },
});

// Self-service: rename yourself. Everyone (members and admins) can do this.
export const updateMe = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const me = await requireProfile(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Name can't be empty.");
    if (trimmed === me.name) return;
    await ctx.db.patch(me._id, { name: trimmed });
    await writeAudit(ctx, {
      actorUserId: me.userId,
      action: "user.renamed",
      entityType: "user",
      entityId: me.userId,
      entityName: trimmed,
      metadata: { from: me.name, to: trimmed },
    });
  },
});

// Self-service: notification preferences.
export const updatePrefs = mutation({
  args: {
    notifyEmail: v.optional(v.boolean()),
    notifyInApp: v.optional(v.boolean()),
    notifyLatenessEmail: v.optional(v.boolean()),
  },
  handler: async (ctx, { notifyEmail, notifyInApp, notifyLatenessEmail }) => {
    const me = await requireProfile(ctx);
    const patch: Record<string, boolean> = {};
    if (notifyEmail !== undefined) patch.notifyEmail = notifyEmail;
    if (notifyInApp !== undefined) patch.notifyInApp = notifyInApp;
    if (notifyLatenessEmail !== undefined) {
      patch.notifyLatenessEmail = notifyLatenessEmail;
    }
    await ctx.db.patch(me._id, patch);
  },
});

// How much approval routing hangs off this person: people who name them as
// their direct approver, plus offices where they're the default. Both have to
// be reassigned before they can be offboarded, or their teams' requests would
// quietly fall through to the superadmins.
async function approverLoad(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<{ people: number; offices: number }> {
  const profiles = await ctx.db.query("profiles").collect();
  const departments = await ctx.db.query("departments").collect();
  return {
    people: profiles.filter((p) => p.managerId === userId).length,
    offices: departments.filter((d) => d.approverId === userId).length,
  };
}

// Admin: full profile for the member detail view, with department + approver
// names resolved.
export const memberProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireTeamAccess(ctx, userId);
    const p = await getProfileByUserId(ctx, userId);
    if (!p) return null;
    const dept = p.departmentId ? await ctx.db.get(p.departmentId) : null;
    const approver = p.managerId
      ? await getProfileByUserId(ctx, p.managerId)
      : null;
    // Whether the viewer may act on this person (enter leave, act as them), as
    // opposed to merely looking them up. Drives which buttons show.
    const canManage = await canManageUser(ctx, me, userId);
    // Lets the offboarding card warn before the button rather than after.
    const approves = await approverLoad(ctx, userId);
    return {
      ...p,
      departmentName: dept?.name ?? null,
      approverName: approver?.name ?? null,
      approvesForPeople: approves.people,
      approvesForOffices: approves.offices,
      canManage,
      canImpersonate:
        canManage &&
        userId !== me.userId &&
        (isSuperadmin(me.role) || !isSuperadmin(p.role)),
    };
  },
});

// Everyone in the company, with department names resolved. The directory is a
// management surface (approve/assign/impersonate), so it's limited to people
// who can act on others: admins, superadmins, and office managers. Regular
// members can't see it.
export const list = query({
  args: {
    asUserId: v.optional(v.id("users")),
    // Narrow to the people the viewer approves for. The dashboard passes it
    // (its figures are about your own remit); the directory doesn't, so it
    // stays the company-wide phonebook.
    teamOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { asUserId, teamOnly }) => {
    const { profile: me } = await resolveActingProfile(ctx, asUserId);
    if (!canApprove(me.role)) throw new ConvexError("Not allowed.");
    const all = await ctx.db.query("profiles").collect();
    const profiles =
      teamOnly && !isSuperadmin(me.role)
        ? (
            await Promise.all(
              all.map(async (p) =>
                (await isOnApproverTeam(ctx, me, p.userId)) ? p : null,
              ),
            )
          ).filter((p): p is NonNullable<typeof p> => p !== null)
        : all;
    const depts = await ctx.db.query("departments").collect();
    const deptName = new Map(depts.map((d) => [d._id, d.name]));
    const deptApprover = new Map(depts.map((d) => [d._id, d.approverId]));
    // Same rule as resolveApprover, resolved in-memory: everything it needs is
    // already loaded, so this stays one query rather than one per person.
    const approverOf = (p: Doc<"profiles">) =>
      p.managerId ??
      (p.departmentId ? (deptApprover.get(p.departmentId) ?? null) : null);
    return profiles.map((p) => ({
      ...p,
      departmentName: p.departmentId ? deptName.get(p.departmentId) : null,
      // Whether the viewer may act as this person, so the directory only
      // offers "Act as" where it will actually work.
      canImpersonate:
        p.userId !== me.userId &&
        (isSuperadmin(me.role)
          ? true
          : !isSuperadmin(p.role) && approverOf(p) === me.userId),
    }));
  },
});

// Admin: change a person's role. Only a superadmin may grant or revoke the
// superadmin tier, or change a superadmin's role.
export const setRole = mutation({
  args: { profileId: v.id("profiles"), role: roleValidator },
  handler: async (ctx, { profileId, role }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    // Anything touching the admin tier — promoting a member to admin/superadmin,
    // or changing an existing admin/superadmin — is superadmin-only. Regular
    // admins cannot create or manage other admins.
    const managingAdmin =
      target.role === "admin" ||
      target.role === "superadmin" ||
      role === "admin" ||
      role === "superadmin";
    if (managingAdmin && actor.role !== "superadmin") {
      throw new ConvexError("Only a superadmin can manage admins.");
    }
    if (target.role === role) return;
    // Taking the superadmin tier away is the one action reserved for the
    // owners. Superadmins can grant it and can demote anyone below them; only
    // an owner can demote a peer, so the top tier can't be quietly hollowed
    // out by whoever gets there first.
    if (target.role === "superadmin") {
      if (!isOwner(actor)) {
        throw new ConvexError(
          "Only an owner can demote a superadmin. Ask one of them to do it.",
        );
      }
      const supers = (await ctx.db.query("profiles").collect()).filter(
        (p) => p.role === "superadmin" && p.active,
      );
      if (supers.length <= 1) {
        throw new ConvexError(
          "That's the last superadmin — promote someone else before demoting this one.",
        );
      }
    }
    // Being given a role (admin tier or office manager) auto-activates — these
    // are deliberate admin actions, not approval-gated sign-ups.
    const elevated = isAdmin(role) || role === "office_manager";
    await ctx.db.patch(profileId, {
      role,
      ...(elevated ? { status: "active" as const } : {}),
    });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "user.role.changed",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
      metadata: { from: target.role, to: role },
    });
  },
});

// Admin: correct someone's name. People arrive from Google with whatever
// their account says, and imported rows carry whatever the spreadsheet had —
// both are routinely wrong. `firstName`/`lastName` are kept in step with the
// full name, since the approval queue and the greeting read from those.
export const setName = mutation({
  args: { profileId: v.id("profiles"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { profileId, name }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    if (!(await canManageUser(ctx, actor, target.userId))) {
      throw new ConvexError("You can only edit people you approve for.");
    }
    const next = name.trim().replace(/\s+/g, " ");
    if (!next) throw new ConvexError("A name is required.");
    if (next === target.name) return;
    const [first, ...rest] = next.split(" ");
    await ctx.db.patch(profileId, {
      name: next,
      firstName: first,
      lastName: rest.join(" ") || undefined,
    });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "user.name.changed",
      entityType: "user",
      entityId: target.userId,
      entityName: `${target.name} → ${next}`,
    });
  },
});

// Admin: keep someone out of every shared view without offboarding them.
// For accounts that belong to the company rather than to a colleague — a
// founder's own login, a shared mailbox, a test account. They keep booking
// leave and keep their balance; they just stop appearing on the calendar, in
// headcount, in office presence and on department rosters. The employee list
// still shows them, flagged, so this can always be undone.
export const setHiddenFromRoster = mutation({
  args: { profileId: v.id("profiles"), hidden: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { profileId, hidden }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    if (!(await canManageUser(ctx, actor, target.userId))) {
      throw new ConvexError("You can only edit people you approve for.");
    }
    if ((target.hiddenFromRoster ?? false) === hidden) return;
    await ctx.db.patch(profileId, { hiddenFromRoster: hidden || undefined });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: hidden ? "user.hidden" : "user.unhidden",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
    });
  },
});

// Admin: assign department and/or direct approver.
export const assign = mutation({
  args: {
    profileId: v.id("profiles"),
    departmentId: v.optional(v.id("departments")),
    managerId: v.optional(v.id("users")),
  },
  handler: async (ctx, { profileId, departmentId, managerId }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    if (target.role === "superadmin" && actor.role !== "superadmin") {
      throw new ConvexError("Only a superadmin can edit a superadmin.");
    }
    await ctx.db.patch(profileId, { departmentId, managerId });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "user.assigned",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
    });
  },
});

// Admin: set a person's job title (their role in the company).
// Admin: set or clear a person's phone number. Free text — numbers arrive in
// every format and we never dial them programmatically.
export const setPhone = mutation({
  args: { profileId: v.id("profiles"), phone: v.string() },
  returns: v.null(),
  handler: async (ctx, { profileId, phone }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    await ctx.db.patch(profileId, { phone: phone.trim() || undefined });
  },
});

// Admin: correct a person's email. This is the SIGN-IN IDENTITY, not just a
// contact field — Google links a first sign-in to an existing account by
// matching the auth `users` row's email, so we write both rows and mark it
// verified. Get it wrong and that person either can't reach their account or
// reaches someone else's, hence the format check and the collision guard.
export const setEmail = mutation({
  args: { profileId: v.id("profiles"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { profileId, email }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      throw new ConvexError("Enter a valid email address.");
    }
    if (next === target.email) return;
    const clash = (
      await ctx.db
        .query("profiles")
        .withIndex("by_email", (q) => q.eq("email", next))
        .collect()
    ).find((p) => p._id !== profileId);
    if (clash) {
      throw new ConvexError(`${next} already belongs to ${clash.name}.`);
    }
    const previous = target.email;
    await ctx.db.patch(profileId, { email: next });
    // Linking only happens against a VERIFIED email, so an address corrected
    // before the person has ever signed in would otherwise mint a duplicate
    // account on their first login.
    const user = await ctx.db.get(target.userId);
    await ctx.db.patch(target.userId, {
      email: next,
      ...(user && (user as any).emailVerificationTime === undefined
        ? { emailVerificationTime: Date.now() }
        : null),
    } as any);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "user.email.changed",
      entityType: "user",
      entityId: target.userId,
      entityName: `${target.name}: ${previous} → ${next}`,
    });
  },
});

export const setTitle = mutation({
  args: { profileId: v.id("profiles"), title: v.string() },
  handler: async (ctx, { profileId, title }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    await ctx.db.patch(profileId, { title: title.trim() || undefined });
  },
});

// Admin: set a person's functional department / team (shown as "Department" in
// the UI). Free text; pass an empty string to clear it.
export const setTeam = mutation({
  args: { profileId: v.id("profiles"), team: v.string() },
  handler: async (ctx, { profileId, team }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    await ctx.db.patch(profileId, { team: team.trim() || undefined });
  },
});

// Admin: set or clear a person's employment start date (drives joining-year
// pro-rating of annual leave). Pass an empty string to clear it.
export const setStartDate = mutation({
  args: { profileId: v.id("profiles"), startDate: v.string() },
  handler: async (ctx, { profileId, startDate }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    const sd = startDate.trim();
    if (sd && !/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      throw new ConvexError("Start date must be a valid date.");
    }
    await ctx.db.patch(profileId, { startDate: sd || undefined });
    // The start date defines where the leave year begins, so changing it moves
    // every past request into a different period. Re-derive their usage.
    await reconcileUsage(ctx, target.userId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "user.startDate.changed",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
      metadata: { startDate: sd || null },
    });
  },
});

// Admin: set the country a person works in (drives their public holidays).
export const setCountry = mutation({
  args: { profileId: v.id("profiles"), country: v.string() },
  handler: async (ctx, { profileId, country }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    await ctx.db.patch(profileId, { country });
    // Country decides calendar vs anniversary leave years, so their existing
    // leave may now belong to different periods.
    await reconcileUsage(ctx, target.userId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "user.country.changed",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
      metadata: { country },
    });
  },
});

// Admin: deactivate or reactivate a person. A superadmin can't be deactivated
// by a regular admin.
export const setActive = mutation({
  args: { profileId: v.id("profiles"), active: v.boolean() },
  handler: async (ctx, { profileId, active }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    if (target.role === "superadmin" && actor.role !== "superadmin") {
      throw new ConvexError("Only a superadmin can deactivate a superadmin.");
    }
    if (!active) {
      // Offboarding now revokes access, so doing it to yourself would lock you
      // out with no way back in.
      if (target.userId === actor.userId) {
        throw new ConvexError("You can't offboard yourself.");
      }
      // Access is revoked on offboarding, so the last superadmin standing must
      // stay — otherwise nobody can administer the app or undo it.
      if (isSuperadmin(target.role)) {
        const all = await ctx.db.query("profiles").collect();
        const others = all.filter(
          (p) =>
            isSuperadmin(p.role) && p.active && p.userId !== target.userId,
        );
        if (others.length === 0) {
          throw new ConvexError(
            "This is the only active superadmin — promote another before offboarding them.",
          );
        }
      }
      // An approver who leaves takes their team's routing with them: requests
      // would silently fall through to the superadmins. Reassign first.
      const { people, offices } = await approverLoad(ctx, target.userId);
      if (people > 0 || offices > 0) {
        const parts = [
          people > 0 && `${people} ${people === 1 ? "person" : "people"}`,
          offices > 0 && `${offices} ${offices === 1 ? "office" : "offices"}`,
        ].filter(Boolean);
        throw new ConvexError(
          `${target.name} is still the approver for ${parts.join(" and ")}. Reassign before offboarding.`,
        );
      }
    }
    await ctx.db.patch(profileId, { active });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: active ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
    });
  },
});

// Admin: revoke or restore sign-in without offboarding. Useful for someone who
// is still staff but shouldn't have app access — a shared-role account, a
// suspension, or people whose leave admins enter on their behalf.
export const setSignInAccess = mutation({
  args: { profileId: v.id("profiles"), allowed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { profileId, allowed }) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get(profileId);
    if (!target) throw new ConvexError("Person not found.");
    if (target.role === "superadmin" && actor.role !== "superadmin") {
      throw new ConvexError("Only a superadmin can change a superadmin's access.");
    }
    if (!allowed) {
      // Same lockout traps as offboarding: this revokes access immediately and
      // the person can't reach the screen that would undo it.
      if (target.userId === actor.userId) {
        throw new ConvexError("You can't revoke your own sign-in.");
      }
      if (isSuperadmin(target.role)) {
        const all = await ctx.db.query("profiles").collect();
        const others = all.filter(
          (p) =>
            isSuperadmin(p.role) &&
            p.active &&
            !p.signInBlocked &&
            p.userId !== target.userId,
        );
        if (others.length === 0) {
          throw new ConvexError(
            "This is the only superadmin who can still sign in — promote another first.",
          );
        }
      }
    }
    await ctx.db.patch(profileId, { signInBlocked: !allowed || undefined });
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: allowed ? "user.signin.restored" : "user.signin.revoked",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
    });
  },
});

// Record the start/stop of an impersonation session. The act of viewing as
// someone is itself auditable. Admin only.
export const logImpersonationStart = mutation({
  args: { targetUserId: v.id("users") },
  handler: async (ctx, { targetUserId }) => {
    const actor = await requireAdmin(ctx);
    const target = await getProfileByUserId(ctx, targetUserId);
    if (!target) throw new ConvexError("That person does not exist.");
    // Mirrors resolveActingProfile, which is the real gate — this just fails
    // fast (and audibly) before the client flips into impersonation mode.
    if (!isSuperadmin(actor.role)) {
      if (isSuperadmin(target.role)) {
        throw new ConvexError("You can't act as a superadmin.");
      }
      if (!(await canManageUser(ctx, actor, targetUserId))) {
        throw new ConvexError("You can only act as people you approve for.");
      }
    }
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "impersonation.start",
      entityType: "user",
      entityId: target.userId,
      entityName: target.name,
      impersonatedUserId: target.userId,
    });
  },
});

export const logImpersonationStop = mutation({
  args: { targetUserId: v.id("users") },
  handler: async (ctx, { targetUserId }) => {
    const actor = await requireAdmin(ctx);
    const target = await getProfileByUserId(ctx, targetUserId);
    await writeAudit(ctx, {
      actorUserId: actor.userId,
      action: "impersonation.stop",
      entityType: "user",
      entityId: targetUserId,
      entityName: target?.name,
      impersonatedUserId: targetUserId,
    });
  },
});
