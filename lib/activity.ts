// Shared vocabulary for the audit trail. Lives here rather than in the activity
// page because the leave-history rows on a profile show the same events, and two
// copies of this map would drift the moment someone adds an action.

export const ACTION_LABELS: Record<string, string> = {
  "leave.requested": "requested leave",
  "leave.admin_entered": "added leave on their behalf",
  "leave.edited": "amended a leave request",
  "leave.amendmentRequested": "asked to change approved leave",
  "leave.amendmentApproved": "approved a change to leave",
  "leave.amendmentRejected": "declined a change to leave",
  "leave.amendmentWithdrawn": "withdrew a change request",
  "leave.revised": "revised leave",
  "leave.approved": "approved leave",
  "leave.rejected": "rejected leave",
  "leave.cancelled": "cancelled leave",
  "lateness.reported": "logged a late arrival",
  "lateness.deleted": "removed a late arrival",
  "user.role.changed": "changed a role",
  "user.assigned": "updated assignment",
  "user.email.changed": "changed a sign-in email",
  "user.activated": "activated a person",
  "user.deactivated": "deactivated a person",
  "user.startDate.changed": "changed a start date",
  "user.country.changed": "changed a country",
  "member.approved": "approved a new member",
  "impersonation.start": "started acting as",
  "impersonation.stop": "stopped acting as",
  "leaveType.created": "added a leave type",
  "department.created": "added an office",
  "holiday.added": "added a holiday",
  "holiday.removed": "removed a holiday",
  "holidays.seeded": "loaded holidays",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
