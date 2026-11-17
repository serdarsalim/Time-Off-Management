import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";

const DEMO_USER_EMAIL = "demo@timeoff.example";
const DEMO_EMAILS = [
  DEMO_USER_EMAIL,
  "olivia.bennett@timeoff.example",
  "harriet.shaw@timeoff.example",
  "daniel.okafor@timeoff.example",
  "priya.raman@timeoff.example",
  "tom.whitfield@timeoff.example",
  "marcus.hale@timeoff.example",
  "sophie.clarke@timeoff.example",
  "ravi.chauhan@timeoff.example",
  "ellie.morgan@timeoff.example",
  "callum.reid@timeoff.example",
  "naomi.foster@timeoff.example",
] as const;

// Every address the demo has ever seeded. clearAppData deletes these by name,
// so a cast change leaves no orphaned user rows behind on the next reset.
const LEGACY_DEMO_EMAILS = [
  "ciara.murphy@timeoff.example",
  "maeve.oneill@timeoff.example",
  "aoife.kelly@timeoff.example",
  "liam.byrne@timeoff.example",
  "nora.fitzgerald@timeoff.example",
  "ela.demir@timeoff.example",
  "aylin.kaya@timeoff.example",
  "emre.arslan@timeoff.example",
  "selin.yildiz@timeoff.example",
  "mert.aydin@timeoff.example",
  "zeynep.celik@timeoff.example",
] as const;

function assertDemo(): void {
  if (process.env.DEMO_MODE !== "true") {
    throw new Error("Demo data operations require DEMO_MODE=true.");
  }
}

export const isDemo = query({
  args: {},
  handler: async () => process.env.DEMO_MODE === "true",
});

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoFrom(base: Date, offsetDays: number): string {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

// UK bank holidays that move: "first Monday in May", "last Monday in August".
// month is 0-indexed. Without this the demo would show a bank holiday landing
// on a Saturday, which reads as a bug rather than as sample data.
function mondayIn(year: number, month: number, which: "first" | "last"): string {
  const date =
    which === "first"
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year, month + 1, 0));
  const step = which === "first" ? 1 : -1;
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + step);
  return date.toISOString().slice(0, 10);
}

function workingDays(start: string, end: string): number {
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let total = 0;
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) total++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

async function clearAppData(ctx: MutationCtx): Promise<void> {
  const tables = [
    "notifications",
    "auditLog",
    "memberNotes",
    "latenessEntries",
    "leaveRequests",
    "allowances",
    "holidays",
    "orgSettings",
    "teams",
    "profiles",
    "departments",
    "countries",
    "leaveTypes",
  ] as const;
  for (const table of tables) {
    for (const row of await ctx.db.query(table).collect()) {
      await ctx.db.delete(row._id);
    }
  }

  for (const email of [...LEGACY_DEMO_EMAILS, ...DEMO_EMAILS.slice(1)]) {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user) await ctx.db.delete(user._id);
  }
}

export const rebuild = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertDemo();
    await clearAppData(ctx);

    const today = startOfToday();
    const year = today.getUTCFullYear();
    const now = Date.now();

    let demoUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_USER_EMAIL))
      .first();
    const demoUserId = demoUser
      ? demoUser._id
      : await ctx.db.insert("users", {
          name: "Demo administrator",
          email: DEMO_USER_EMAIL,
          isAnonymous: true,
        });

    // A fictional UK company across two offices. One country keeps the leave
    // rules simple; two offices keep the office/approver split on display.
    const people = [
      { name: "Demo administrator", email: DEMO_USER_EMAIL, role: "superadmin" as const, country: "GB", office: "London", team: "Operations", title: "Workspace owner", hidden: true },
      { name: "Olivia Bennett", email: DEMO_EMAILS[1], role: "office_manager" as const, country: "GB", office: "London", team: "Sales", title: "Sales manager" },
      { name: "Harriet Shaw", email: DEMO_EMAILS[2], role: "admin" as const, country: "GB", office: "London", team: "Operations", title: "People operations lead" },
      { name: "Daniel Okafor", email: DEMO_EMAILS[3], role: "member" as const, country: "GB", office: "London", team: "Sales", title: "Account executive" },
      { name: "Priya Raman", email: DEMO_EMAILS[4], role: "member" as const, country: "GB", office: "London", team: "Marketing", title: "Content specialist" },
      { name: "Tom Whitfield", email: DEMO_EMAILS[5], role: "member" as const, country: "GB", office: "London", team: "Operations", title: "Operations coordinator" },
      { name: "Marcus Hale", email: DEMO_EMAILS[6], role: "office_manager" as const, country: "GB", office: "Manchester", team: "Sales", title: "Sales manager" },
      { name: "Sophie Clarke", email: DEMO_EMAILS[7], role: "member" as const, country: "GB", office: "Manchester", team: "Sales", title: "Account executive" },
      { name: "Ravi Chauhan", email: DEMO_EMAILS[8], role: "member" as const, country: "GB", office: "Manchester", team: "Marketing", title: "Growth specialist" },
      { name: "Ellie Morgan", email: DEMO_EMAILS[9], role: "member" as const, country: "GB", office: "Manchester", team: "Operations", title: "Support coordinator" },
      { name: "Callum Reid", email: DEMO_EMAILS[10], role: "member" as const, country: "GB", office: "Manchester", team: "Sales", title: "Account executive" },
      { name: "Naomi Foster", email: DEMO_EMAILS[11], role: "member" as const, country: "GB", office: "Manchester", team: "Finance", title: "Finance coordinator" },
    ];

    const userIds = new Map<string, Id<"users">>([[DEMO_USER_EMAIL, demoUserId]]);
    for (const person of people.slice(1)) {
      const userId = await ctx.db.insert("users", {
        name: person.name,
        email: person.email,
      });
      userIds.set(person.email, userId);
    }

    const officeIds = new Map<string, Id<"departments">>();
    officeIds.set(
      "London",
      await ctx.db.insert("departments", {
        name: "London",
        approverId: userIds.get(DEMO_EMAILS[1]),
      }),
    );
    officeIds.set(
      "Manchester",
      await ctx.db.insert("departments", {
        name: "Manchester",
        approverId: userIds.get(DEMO_EMAILS[6]),
      }),
    );

    for (const name of ["Sales", "Finance", "Marketing", "Operations"]) {
      await ctx.db.insert("teams", { name });
    }

    for (const [index, person] of people.entries()) {
      const parts = person.name.split(" ");
      await ctx.db.insert("profiles", {
        userId: userIds.get(person.email)!,
        name: person.name,
        email: person.email,
        firstName: parts[0],
        lastName: parts.slice(1).join(" ") || undefined,
        role: person.role,
        status: "active",
        title: person.title,
        departmentId: officeIds.get(person.office),
        team: person.team,
        active: true,
        hiddenFromRoster: person.hidden || undefined,
        notifyEmail: false,
        notifyInApp: true,
        country: person.country,
        startDate: `${year - (index % 5) - 1}-${String((index % 8) + 1).padStart(2, "0")}-01`,
      });
    }

    const gbAnnual = await ctx.db.insert("leaveTypes", {
      name: "Annual leave",
      color: "#0e7a5f",
      countryCode: "GB",
      defaultAllowanceDays: 25,
      deductsAllowance: true,
      active: true,
      carryOverMaxDays: 5,
      sortOrder: 0,
    });
    const gbSick = await ctx.db.insert("leaveTypes", {
      name: "Sick leave",
      color: "#e85d75",
      countryCode: "GB",
      defaultAllowanceDays: 10,
      deductsAllowance: true,
      allowDoc: true,
      active: true,
      sortOrder: 1,
    });
    const gbWfh = await ctx.db.insert("leaveTypes", {
      name: "Work from home",
      color: "#f0c419",
      countryCode: "GB",
      defaultAllowanceDays: 0,
      deductsAllowance: false,
      active: true,
      sortOrder: 2,
    });
    const gbUnpaid = await ctx.db.insert("leaveTypes", {
      name: "Unpaid leave",
      color: "#9ca3af",
      countryCode: "GB",
      defaultAllowanceDays: 0,
      deductsAllowance: false,
      active: true,
      sortOrder: 3,
    });

    await ctx.db.insert("countries", {
      code: "GB",
      name: "United Kingdom",
      leaveYearMode: "calendar",
      active: true,
      annualLeaveTypeId: gbAnnual,
      workDays: [1, 2, 3, 4, 5],
    });
    await ctx.db.insert("orgSettings", { calendarScope: "company" });

    const holidays = [
      [`${year}-01-01`, "New Year's Day", "GB"],
      [mondayIn(year, 4, "first"), "Early May bank holiday", "GB"],
      [mondayIn(year, 4, "last"), "Spring bank holiday", "GB"],
      [mondayIn(year, 7, "last"), "Summer bank holiday", "GB"],
      [`${year}-12-25`, "Christmas Day", "GB"],
      [`${year}-12-26`, "Boxing Day", "GB"],
    ] as const;
    for (const [date, name, country] of holidays) {
      await ctx.db.insert("holidays", { date, name, year, country });
    }

    const types = { gbAnnual, gbSick, gbWfh, gbUnpaid };
    const requests = [
      { email: DEMO_EMAILS[3], type: gbAnnual, from: 7, to: 11, status: "pending" as const, note: "Family trip to Cornwall" },
      { email: DEMO_EMAILS[4], type: gbWfh, from: 1, to: 1, status: "approved" as const, note: "Home appointment" },
      { email: DEMO_EMAILS[5], type: gbAnnual, from: 18, to: 22, status: "approved" as const, note: "Summer break" },
      { email: DEMO_EMAILS[7], type: gbAnnual, from: 4, to: 8, status: "pending" as const, note: "Wedding in Edinburgh" },
      { email: DEMO_EMAILS[8], type: gbWfh, from: 2, to: 2, status: "approved" as const, note: "Broadband installation" },
      { email: DEMO_EMAILS[9], type: gbAnnual, from: 26, to: 30, status: "approved" as const, note: "Annual leave" },
      { email: DEMO_EMAILS[10], type: gbSick, from: -3, to: -2, status: "approved" as const, note: "Medical recovery" },
      { email: DEMO_EMAILS[11], type: gbUnpaid, from: 35, to: 36, status: "rejected" as const, note: "Personal appointment" },
      { email: DEMO_EMAILS[3], type: gbSick, from: -12, to: -11, status: "approved" as const, note: "Flu" },
      { email: DEMO_EMAILS[4], type: gbAnnual, from: -35, to: -31, status: "approved" as const, note: "City break" },
      { email: DEMO_EMAILS[5], type: gbWfh, from: -7, to: -7, status: "approved" as const, note: "Delivery window" },
      { email: DEMO_EMAILS[7], type: gbSick, from: -24, to: -23, status: "approved" as const, note: "Doctor's note supplied" },
      { email: DEMO_EMAILS[8], type: gbAnnual, from: -48, to: -44, status: "approved" as const, note: "Holiday" },
      { email: DEMO_EMAILS[9], type: gbWfh, from: -5, to: -5, status: "cancelled" as const, note: "Plans changed" },
      { email: DEMO_EMAILS[10], type: gbAnnual, from: 47, to: 51, status: "pending" as const, note: "Family holiday" },
    ];

    for (const [index, request] of requests.entries()) {
      const startDate = isoFrom(today, request.from);
      const endDate = isoFrom(today, request.to);
      const decided = request.status === "approved" || request.status === "rejected";
      const requestId = await ctx.db.insert("leaveRequests", {
        userId: userIds.get(request.email)!,
        leaveTypeId: request.type,
        startDate,
        endDate,
        days: workingDays(startDate, endDate),
        status: request.status,
        note: request.note,
        decidedBy: decided ? demoUserId : undefined,
        decidedAt: decided ? now - (index + 1) * 86_400_000 : undefined,
        decisionNote: request.status === "rejected" ? "Please choose dates outside the finance close." : undefined,
        proposedStartDate: index === 2 ? isoFrom(today, 19) : undefined,
        proposedEndDate: index === 2 ? isoFrom(today, 23) : undefined,
        proposedDays: index === 2 ? workingDays(isoFrom(today, 19), isoFrom(today, 23)) : undefined,
        proposedReason: index === 2 ? "Flights moved by one day" : undefined,
        amendmentStatus: index === 2 ? "pending" : undefined,
        amendmentRequestedAt: index === 2 ? now - 3_600_000 : undefined,
      });

      const actor = request.status === "pending" ? userIds.get(request.email)! : demoUserId;
      const action = request.status === "pending" ? "leave.requested" : request.status === "rejected" ? "leave.rejected" : request.status === "cancelled" ? "leave.cancelled" : "leave.approved";
      const person = people.find((p) => p.email === request.email)!;
      await ctx.db.insert("auditLog", {
        actorUserId: actor,
        actorName: actor === demoUserId ? "Demo administrator" : person.name,
        action,
        entityType: "leaveRequest",
        entityId: String(requestId),
        entityName: person.name,
        timestamp: now - index * 3_600_000,
        searchText: `${person.name} ${action} ${request.note}`.toLowerCase(),
      });
    }

    const allowanceTypes = {
      GB: [types.gbAnnual, types.gbSick],
    } as const;
    for (const [index, person] of people.entries()) {
      if (person.hidden) continue;
      for (const [typeIndex, leaveTypeId] of allowanceTypes[person.country as "GB"].entries()) {
        await ctx.db.insert("allowances", {
          userId: userIds.get(person.email)!,
          leaveTypeId,
          year,
          carriedInDays: typeIndex === 0 ? index % 4 : 0,
          extraDays: typeIndex === 0 && index % 5 === 0 ? 2 : 0,
          usedDays: typeIndex === 0 ? (index * 2) % 9 : index % 3,
        });
      }
    }

    for (const [index, email] of [DEMO_EMAILS[3], DEMO_EMAILS[7], DEMO_EMAILS[8], DEMO_EMAILS[10]].entries()) {
      await ctx.db.insert("latenessEntries", {
        userId: userIds.get(email)!,
        date: isoFrom(today, -index * 4 - 1),
        minutes: [12, 25, 8, 40][index],
        reason: ["Delayed train", "Traffic on the ring road", "School drop-off", "Medical appointment ran late"][index],
        createdAt: now - index * 4 * 86_400_000,
      });
    }

    await ctx.db.insert("memberNotes", {
      memberUserId: userIds.get(DEMO_EMAILS[3])!,
      authorUserId: demoUserId,
      authorName: "Demo administrator",
      body: "Cover confirmed for the September launch week.",
      createdAt: now - 2 * 86_400_000,
    });

    for (const [index, title] of [
      "Three requests need a decision",
      "Tom asked to change approved leave",
      "Sophie logged a late arrival",
    ].entries()) {
      await ctx.db.insert("notifications", {
        recipientUserId: demoUserId,
        type: index === 2 ? "lateness" : "leave",
        title,
        body: index === 0 ? "Open Approvals to review them." : undefined,
        createdAt: now - index * 90 * 60_000,
      });
    }

    return { people: people.length, requests: requests.length };
  },
});

export const resetDemoFromCli = internalAction({
  args: {},
  handler: async (ctx): Promise<{ people: number; requests: number }> => {
    assertDemo();
    return await ctx.runMutation(internal.demo.rebuild, {});
  },
});

export const nightlyReset = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    if (process.env.DEMO_MODE !== "true") return null;
    await ctx.runMutation(internal.demo.rebuild, {});
    return null;
  },
});
