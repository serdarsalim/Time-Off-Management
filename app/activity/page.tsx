"use client";

import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import { Card, SectionTitle, Empty, SecondaryButton } from "@/components/ui";
import { useImpersonatedUserId, useEffectiveRole } from "@/lib/impersonation";
import { actionLabel, formatTime } from "@/lib/activity";

export default function ActivityPage() {
  const asUserId = useImpersonatedUserId();
  const role = useEffectiveRole();
  const [search, setSearch] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.activity.list,
    { search: search.trim() || undefined, asUserId: asUserId ?? undefined },
    { initialNumItems: 30 },
  );

  if (role !== undefined && role !== "superadmin") {
    return (
      <AppShell>
        <Empty>Superadmins only.</Empty>
      </AppShell>
    );
  }

  return (
    <AppShell
      search={{
        value: search,
        onChange: setSearch,
        }}
      title="Activity"
      titleInfo={<InfoHint>Every meaningful action, newest first.</InfoHint>}
    >

      <Card className="p-0">
        {results.length === 0 && status !== "LoadingFirstPage" ? (
          <div className="p-5">
            <Empty>No activity yet.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {results.map((e) => (
              <li key={e._id} className="flex items-start gap-3 px-5 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {(e.actorName ?? "·").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground">
                    <span className="font-medium">
                      {e.actorName ?? "System"}
                    </span>{" "}
                    <span className="text-muted">{actionLabel(e.action)}</span>
                    {e.entityName && (
                      <span className="font-medium"> {e.entityName}</span>
                    )}
                  </div>
                  {e.impersonatedName &&
                    !e.action.startsWith("impersonation") && (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        acting as {e.impersonatedName}
                      </div>
                    )}
                </div>
                <div className="shrink-0 text-xs text-muted">
                  {formatTime(e.timestamp)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {status === "CanLoadMore" && (
        <div className="mt-4 text-center">
          <SecondaryButton onClick={() => loadMore(30)}>
            Load more
          </SecondaryButton>
        </div>
      )}
    </AppShell>
  );
}
