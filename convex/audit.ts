import { MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

async function profileName(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string | undefined> {
  const p = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return p?.name;
}

export type AuditEntry = {
  actorUserId?: Id<"users">;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  impersonatedUserId?: Id<"users">;
  metadata?: unknown;
};

// Record an audit-log row. Freezes actor/impersonated display names at write
// time and builds a lowercased searchText for the activity-log search.
export async function writeAudit(
  ctx: MutationCtx,
  entry: AuditEntry,
): Promise<void> {
  const actorName = entry.actorUserId
    ? await profileName(ctx, entry.actorUserId)
    : undefined;
  const impersonatedName = entry.impersonatedUserId
    ? await profileName(ctx, entry.impersonatedUserId)
    : undefined;

  const searchText = [
    entry.action,
    actorName,
    entry.entityName,
    impersonatedName,
    entry.entityType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  await ctx.db.insert("auditLog", {
    actorUserId: entry.actorUserId,
    actorName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityName: entry.entityName,
    impersonatedUserId: entry.impersonatedUserId,
    impersonatedName,
    metadata: entry.metadata,
    searchText,
    timestamp: Date.now(),
  });
}
