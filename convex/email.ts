import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { formatLateness, formatDay } from "./format";

// Deployment-specific; the demo deployment sets its own so no mail can go out
// carrying another tenant's name.
const APP_NAME = process.env.APP_NAME ?? "Time Off";
const FROM = process.env.LEAVE_FROM_EMAIL ?? `${APP_NAME} <onboarding@resend.dev>`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

// Send through the Resend HTTP API with fetch. fetch works in Convex's default
// runtime, so this file needs no "use node" — which means the whole backend
// deploys on any Node version (the local dev backend rejects "use node" unless
// Node 18/20/22/24 is on PATH).
async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email.");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    console.error("Resend send failed", res.status, await res.text());
  }
}

// Notify the approver that a new request needs a decision.
export const notifyRequest = internalAction({
  args: {
    requestId: v.id("leaveRequests"),
    approverId: v.optional(v.id("users")),
  },
  handler: async (ctx, { requestId, approverId }) => {
    if (!process.env.RESEND_API_KEY) return;

    const data = await ctx.runQuery(internal.leave.getForEmail, { requestId });
    if (!data) return;

    if (!approverId) {
      console.warn("No approver for request", requestId);
      return;
    }
    const approver = await ctx.runQuery(internal.leave.emailForUser, {
      userId: approverId,
    });
    if (!approver || !approver.email) return;
    if (!approver.notifyEmail) return; // recipient opted out of email

    const { request, applicantName, leaveTypeName } = data;
    await sendEmail({
      to: approver.email,
      subject: `Leave request from ${applicantName}`,
      html: `
        <p>${applicantName} requested <strong>${leaveTypeName}</strong>.</p>
        <p>${request.startDate} to ${request.endDate} (${request.days} working day${request.days === 1 ? "" : "s"})</p>
        ${request.note ? `<p>Note: ${request.note}</p>` : ""}
        <p><a href="${APP_URL}/approvals">Review in ${APP_NAME}</a></p>
      `,
    });
  },
});

// Notify the people who manage a late arrival — the person's approver plus every
// superadmin — each only if they've opted in to lateness emails (default off).
// getForEmail resolves and gates the recipient list; here we just send.
export const notifyLateness = internalAction({
  args: {
    entryId: v.id("latenessEntries"),
  },
  handler: async (ctx, { entryId }) => {
    if (!process.env.RESEND_API_KEY) return;

    const data = await ctx.runQuery(internal.lateness.getForEmail, { entryId });
    if (!data || data.emails.length === 0) return;

    const { entry, personName, emails } = data;
    const late = formatLateness(entry.minutes);
    for (const to of emails) {
      await sendEmail({
        to,
        subject: `${personName} logged a late arrival`,
        html: `
          <p><strong>${personName}</strong> was <strong>${late}</strong> late on ${formatDay(entry.date)}.</p>
          <p>Reason: ${entry.reason}</p>
          <p><a href="${APP_URL}/employees">View in ${APP_NAME}</a></p>
        `,
      });
    }
  },
});

// Notify the approver that an employee wants to change leave that's already
// approved. Leads with the current dates, because those are the ones the
// approver may have built a rota around.
export const notifyAmendment = internalAction({
  args: {
    requestId: v.id("leaveRequests"),
    approverId: v.optional(v.id("users")),
  },
  handler: async (ctx, { requestId, approverId }) => {
    if (!process.env.RESEND_API_KEY) return;

    const data = await ctx.runQuery(internal.leave.getForEmail, { requestId });
    if (!data) return;
    if (!approverId) {
      console.warn("No approver for amendment on request", requestId);
      return;
    }
    const approver = await ctx.runQuery(internal.leave.emailForUser, {
      userId: approverId,
    });
    if (!approver || !approver.email) return;
    if (!approver.notifyEmail) return; // recipient opted out of email

    const { request, applicantName, leaveTypeName } = data;
    if (!request.proposedStartDate || !request.proposedEndDate) return;
    await sendEmail({
      to: approver.email,
      subject: `${applicantName} wants to change approved leave`,
      html: `
        <p><strong>${applicantName}</strong> asked to change approved <strong>${leaveTypeName}</strong>.</p>
        <p>Currently: ${request.startDate} to ${request.endDate} (${request.days} working day${request.days === 1 ? "" : "s"})</p>
        <p>Proposed: ${request.proposedStartDate} to ${request.proposedEndDate} (${request.proposedDays} working day${request.proposedDays === 1 ? "" : "s"})</p>
        ${request.proposedReason ? `<p>Reason: ${request.proposedReason}</p>` : ""}
        <p>The current dates stand until you decide.</p>
        <p><a href="${APP_URL}/approvals">Review in ${APP_NAME}</a></p>
      `,
    });
  },
});

// Notify the employee that their amendment was approved or declined.
export const notifyAmendmentDecision = internalAction({
  args: { requestId: v.id("leaveRequests") },
  handler: async (ctx, { requestId }) => {
    if (!process.env.RESEND_API_KEY) return;

    const data = await ctx.runQuery(internal.leave.getForEmail, { requestId });
    if (!data || !data.applicantEmail) return;
    if (!data.applicantNotifyEmail) return; // recipient opted out of email

    const { request, leaveTypeName } = data;
    // An approved amendment clears amendmentStatus and folds the new dates in;
    // a declined one leaves the marker and the proposal behind.
    const declined = request.amendmentStatus === "rejected";
    await sendEmail({
      to: data.applicantEmail,
      subject: `Your ${leaveTypeName} amendment was ${declined ? "declined" : "approved"}`,
      html: declined
        ? `
        <p>Your request to change <strong>${leaveTypeName}</strong> to ${request.proposedStartDate} to ${request.proposedEndDate} was <strong>declined</strong>.</p>
        <p>Your leave stands as approved: ${request.startDate} to ${request.endDate} (${request.days} working day${request.days === 1 ? "" : "s"}).</p>
        ${request.amendmentDecisionNote ? `<p>Note: ${request.amendmentDecisionNote}</p>` : ""}
        <p><a href="${APP_URL}/requests">View your requests</a></p>
      `
        : `
        <p>Your <strong>${leaveTypeName}</strong> amendment was <strong>approved</strong>.</p>
        <p>Your leave is now ${request.startDate} to ${request.endDate} (${request.days} working day${request.days === 1 ? "" : "s"}).</p>
        ${request.amendmentDecisionNote ? `<p>Note: ${request.amendmentDecisionNote}</p>` : ""}
        <p><a href="${APP_URL}/requests">View your requests</a></p>
      `,
    });
  },
});

// Notify the approver that leave they'd approved has been cancelled. Without
// this, someone who arranged cover finds out only by checking the calendar.
export const notifyCancellation = internalAction({
  args: {
    requestId: v.id("leaveRequests"),
    approverId: v.optional(v.id("users")),
  },
  handler: async (ctx, { requestId, approverId }) => {
    if (!process.env.RESEND_API_KEY) return;

    const data = await ctx.runQuery(internal.leave.getForEmail, { requestId });
    if (!data || !approverId) return;
    const approver = await ctx.runQuery(internal.leave.emailForUser, {
      userId: approverId,
    });
    if (!approver || !approver.email) return;
    if (!approver.notifyEmail) return; // recipient opted out of email

    const { request, applicantName, leaveTypeName } = data;
    await sendEmail({
      to: approver.email,
      subject: `${applicantName} cancelled leave`,
      html: `
        <p><strong>${applicantName}</strong> cancelled <strong>${leaveTypeName}</strong>.</p>
        <p>${request.startDate} to ${request.endDate} (${request.days} working day${request.days === 1 ? "" : "s"})</p>
        <p><a href="${APP_URL}/calendar">View the calendar</a></p>
      `,
    });
  },
});

// Notify the employee that their request was approved or rejected.
export const notifyDecision = internalAction({
  args: { requestId: v.id("leaveRequests") },
  handler: async (ctx, { requestId }) => {
    if (!process.env.RESEND_API_KEY) return;

    const data = await ctx.runQuery(internal.leave.getForEmail, { requestId });
    if (!data || !data.applicantEmail) return;
    if (!data.applicantNotifyEmail) return; // recipient opted out of email

    const { request, leaveTypeName } = data;
    const decision = request.status === "approved" ? "approved" : "rejected";
    await sendEmail({
      to: data.applicantEmail,
      subject: `Your ${leaveTypeName} request was ${decision}`,
      html: `
        <p>Your <strong>${leaveTypeName}</strong> request for ${request.startDate} to ${request.endDate} was <strong>${decision}</strong>.</p>
        ${request.decisionNote ? `<p>Note: ${request.decisionNote}</p>` : ""}
        <p><a href="${APP_URL}/requests">View your requests</a></p>
      `,
    });
  },
});
