"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { RequestForm, type EditableRequest } from "@/components/RequestForm";
import { AmendForm, type AmendableRequest } from "@/components/AmendForm";
import { LatenessForm } from "@/components/LatenessForm";
import { Modal } from "@/components/Modal";
import { FilterSelect } from "@/components/SortableTable";
import { Card, SectionTitle, StatusPill, TypeDot, Empty } from "@/components/ui";
import { formatRange, formatDay, formatLateness, halfLabel, todayISO } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { useImpersonatedUserId } from "@/lib/impersonation";

export default function RequestsPage() {
  const impersonatedId = useImpersonatedUserId();
  const asUserId = impersonatedId ?? undefined;
  const myRequests = useQuery(api.leave.myRequests, {
    asUserId: asUserId as any,
  });
  const myLateness = useQuery(api.lateness.mine, {
    asUserId: asUserId as any,
  });
  const cancel = useMutation(api.leave.cancel);
  const withdrawAmendment = useMutation(api.leave.withdrawAmendment);

  const [mode, setMode] = useState<"leave" | "lateness">("leave");
  const [editing, setEditing] = useState<EditableRequest | null>(null);
  const [amending, setAmending] = useState<AmendableRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  // History carries both leave and late arrivals: they're the same question —
  // what happened to my attendance — and a late arrival filed inside the
  // booking card was the one thing on the page with nowhere of its own to
  // live. Ordered by the date they refer to, not submission order.
  //
  // The filters are built for leave, so lateness answers neither: it has no
  // status and no leave type. A status filter therefore takes it out, and it
  // gets its own entry in the type filter to be seen on its own.
  const LATE = "Late arrival";
  const showLate = !statusFilter && (!typeFilter || typeFilter === LATE);
  const showLeave = typeFilter !== LATE;
  type LeaveRow = NonNullable<typeof myRequests>[number];
  type LateRow = NonNullable<typeof myLateness>[number];
  const historyItems: (
    | { kind: "leave"; date: string; leave: LeaveRow }
    | { kind: "late"; date: string; late: LateRow }
  )[] = [
    ...(showLeave ? (myRequests ?? []) : [])
      .filter((r) => (statusFilter ? r.status === statusFilter : true))
      .filter((r) =>
        typeFilter && typeFilter !== LATE ? r.leaveTypeName === typeFilter : true,
      )
      .map((r) => ({ kind: "leave" as const, date: r.startDate, leave: r })),
    ...(showLate ? (myLateness ?? []) : []).map((l) => ({
      kind: "late" as const,
      date: l.date,
      late: l,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const nothingLogged =
    (myRequests?.length ?? 0) === 0 && (myLateness?.length ?? 0) === 0;
  const typeNames = [
    ...new Set((myRequests ?? []).map((r) => r.leaveTypeName)),
  ].sort();
  if ((myLateness?.length ?? 0) > 0) typeNames.push(LATE);

  return (
    <AppShell title="My Leave">
      <div className="space-y-6">
        <Card>
          {/* Leave is the primary, frequent action; a late arrival is
              occasional — so it lives behind a toggle rather than its own card. */}
          <div className="mb-4 flex justify-end">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setMode("leave")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "leave"
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Request leave
              </button>
              <button
                type="button"
                onClick={() => setMode("lateness")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "lateness"
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Late arrival
              </button>
            </div>
          </div>

          {/* Both forms occupy the same grid cell, so the card is always as
              tall as the taller one and toggling never reflows the page — the
              inactive form is just hidden in place. */}
          <div className="grid">
            <div
              className={`col-start-1 row-start-1 ${
                mode === "leave" ? "" : "invisible"
              }`}
              aria-hidden={mode !== "leave"}
            >
              <RequestForm asUserId={asUserId} />
            </div>
            <div
              className={`col-start-1 row-start-1 ${
                mode === "lateness" ? "" : "invisible"
              }`}
              aria-hidden={mode !== "lateness"}
            >
              <LatenessForm asUserId={asUserId} />
            </div>
          </div>
        </Card>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 [&_h2]:mb-0">
            <SectionTitle>History</SectionTitle>
            {!nothingLogged && (
              <div className="flex flex-wrap gap-2">
                <FilterSelect
                  label="Filter by status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "", label: "All statuses" },
                    { value: "pending", label: "Pending" },
                    { value: "approved", label: "Approved" },
                    { value: "rejected", label: "Rejected" },
                    { value: "cancelled", label: "Cancelled" },
                  ]}
                />
                <FilterSelect
                  label="Filter by type"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { value: "", label: "All types" },
                    ...typeNames.map((t) => ({ value: t, label: t })),
                  ]}
                />
              </div>
            )}
          </div>
          {error && (
            <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {myRequests === undefined ? (
            <Empty>Loading…</Empty>
          ) : nothingLogged ? (
            <Empty>Nothing logged yet.</Empty>
          ) : historyItems.length === 0 ? (
            <Empty>Nothing matches the filters.</Empty>
          ) : (
            <div className="space-y-2">
              {historyItems.map((item) => {
                // Self-reported, nobody decides on it — so it carries no
                // status pill and no actions, just what happened.
                if (item.kind === "late") {
                  return (
                    <Card key={item.late._id} className="p-4">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-1">
                          <TypeDot color="#f59e0b" />
                        </span>
                        <div>
                          <div className="font-medium text-foreground">
                            Late arrival
                          </div>
                          <div className="text-sm text-muted">
                            {formatDay(item.late.date)} ·{" "}
                            {formatLateness(item.late.minutes)} late
                          </div>
                          {item.late.reason && (
                            <div className="mt-1 text-sm text-muted">
                              “{item.late.reason}”
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                }
                const r = item.leave;
                return (
                <Card key={r._id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1">
                        <TypeDot color={r.leaveTypeColor} />
                      </span>
                      <div>
                        <div className="font-medium text-foreground">
                          {r.leaveTypeName}
                        </div>
                        <div className="text-sm text-muted">
                          {formatRange(r.startDate, r.endDate)} · {r.days}{" "}
                          working day{r.days === 1 ? "" : "s"}
                          {halfLabel(r) && (
                            <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                              {halfLabel(r)}
                            </span>
                          )}
                        </div>
                        {r.note && (
                          <div className="mt-1 text-sm text-muted">
                            “{r.note}”
                          </div>
                        )}
                        {r.decisionNote && (
                          <div className="mt-1 text-sm text-muted">
                            Manager: {r.decisionNote}
                          </div>
                        )}
                        {/* A live amendment. The dates above are still the
                            ones that count until it's decided, so this reads
                            as a proposal, not a change. */}
                        {r.amendmentStatus === "pending" &&
                          r.proposedStartDate && (
                            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-sm">
                              <span className="font-medium text-amber-700 dark:text-amber-400">
                                Change requested
                              </span>
                              <span className="ml-1.5 text-muted">
                                to{" "}
                                {formatRange(
                                  r.proposedStartDate,
                                  r.proposedEndDate!,
                                )}{" "}
                                ({r.proposedDays} day
                                {r.proposedDays === 1 ? "" : "s"}) — awaiting
                                your approver. Current dates stand until then.
                              </span>
                            </div>
                          )}
                        {r.amendmentStatus === "rejected" &&
                          r.proposedStartDate && (
                            <div className="mt-2 text-sm text-muted">
                              Change to{" "}
                              {formatRange(
                                r.proposedStartDate,
                                r.proposedEndDate!,
                              )}{" "}
                              was declined
                              {r.amendmentDecisionNote
                                ? ` — ${r.amendmentDecisionNote}`
                                : "."}
                            </div>
                          )}
                        {r.documentUrl && (
                          <a
                            href={r.documentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline"
                          >
                            📎 {r.documentName ?? "Document"}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusPill status={r.status} />
                      <div className="flex items-center gap-3">
                        {/* Pending: nothing's been decided, so the request is
                            simply rewritten in place. */}
                        {r.status === "pending" && (
                          <button
                            onClick={() => setEditing(r as EditableRequest)}
                            className="text-xs text-muted transition-colors hover:text-foreground"
                          >
                            Amend
                          </button>
                        )}
                        {/* Approved and not yet finished: propose new dates
                            for the approver. Mid-leave counts — that's the
                            "back on Friday after all" case. */}
                        {r.status === "approved" &&
                          r.endDate >= todayISO() &&
                          r.amendmentStatus !== "pending" && (
                            <button
                              onClick={() => setAmending(r as AmendableRequest)}
                              className="text-xs text-muted transition-colors hover:text-foreground"
                            >
                              Request change
                            </button>
                          )}
                        {r.amendmentStatus === "pending" && (
                          <button
                            onClick={() =>
                              void withdrawAmendment({
                                requestId: r._id as Id<"leaveRequests">,
                                asUserId: asUserId as any,
                              })
                            }
                            className="text-xs text-muted transition-colors hover:text-foreground"
                          >
                            Withdraw change
                          </button>
                        )}
                        {/* Cancel takes back the whole request, so it's only
                            offered before the leave starts. Once it's under
                            way, amending is the honest verb — cancelling
                            would refund days already taken. */}
                        {(r.status === "pending" ||
                          (r.status === "approved" &&
                            r.startDate > todayISO())) && (
                          <button
                            onClick={() => {
                              setError(null);
                              void cancel({
                                requestId: r._id as Id<"leaveRequests">,
                                asUserId: asUserId as any,
                              }).catch((err) =>
                                setError(
                                  errorMessage(err, "Could not cancel that."),
                                ),
                              );
                            }}
                            className="text-xs text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Keyed on the request id so switching between two pending requests
          remounts the form and reloads its prefill. */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Amend request"
      >
        {editing && (
          <>
            <p className="mb-3 text-sm text-muted">
              This request hasn’t been decided yet, so your changes replace it
              and it stays pending. Your approver is told what changed.
            </p>
            <RequestForm
              key={editing._id}
              asUserId={asUserId}
              editRequest={editing}
              onDone={() => setEditing(null)}
            />
          </>
        )}
      </Modal>

      <Modal
        open={amending !== null}
        onClose={() => setAmending(null)}
        title="Request a change"
      >
        {amending && (
          <>
            <p className="mb-3 text-sm text-muted">
              Your approver decides this. Until they do, the dates you already
              have stay approved and on the calendar.
            </p>
            <AmendForm
              key={amending._id}
              request={amending}
              asUserId={asUserId}
              onDone={() => setAmending(null)}
            />
          </>
        )}
      </Modal>
    </AppShell>
  );
}
