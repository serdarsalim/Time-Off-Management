"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import {
  Balance,
  BalanceNote,
  NegativeBalanceModal,
  goesNegative,
} from "@/components/BalanceWarning";
import {
  Card,
  TypeDot,
  Empty,
  PrimaryButton,
  SectionTitle,
} from "@/components/ui";
import { formatRange, halfLabel } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { useImpersonatedUserId } from "@/lib/impersonation";

// The approve click that's about to put someone under, held for confirmation.
type Confirming = {
  id: Id<"leaveRequests">;
  kind: "request" | "amendment";
  name: string;
  balance: NonNullable<Balance>;
};

export default function ApprovalsPage() {
  const asUserId = useImpersonatedUserId();
  const pendingRaw = useQuery(api.leave.pendingApprovals, {
    asUserId: asUserId ?? undefined,
  });
  // Soonest leave first — the decision that can't wait sits on top.
  const pending = pendingRaw
    ? [...pendingRaw].sort((a, b) => a.startDate.localeCompare(b.startDate))
    : undefined;
  const amendmentsRaw = useQuery(api.leave.pendingAmendments, {
    asUserId: asUserId ?? undefined,
  });
  // Soonest affected leave first, same as the queue above.
  const amendments = amendmentsRaw
    ? [...amendmentsRaw].sort((a, b) => a.startDate.localeCompare(b.startDate))
    : undefined;
  const approve = useMutation(api.leave.approve);
  const reject = useMutation(api.leave.reject);
  const decideAmendment = useMutation(api.leave.decideAmendment);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  // Approving is one click unless it pushes the person's balance below zero —
  // then it costs a dialog. Nothing is blocked, the approver just can't do it
  // without having been told.
  function askApprove(
    id: Id<"leaveRequests">,
    kind: "request" | "amendment",
    name: string,
    balance: Balance,
  ) {
    if (goesNegative(balance)) {
      setConfirming({ id, kind, name, balance });
      return;
    }
    if (kind === "request") void decide(id, "approve");
    else void decideChange(id, true);
  }

  function confirmApprove() {
    if (!confirming) return;
    const { id, kind } = confirming;
    setConfirming(null);
    if (kind === "request") void decide(id, "approve");
    else void decideChange(id, true);
  }

  async function decide(
    id: Id<"leaveRequests">,
    action: "approve" | "reject",
  ) {
    setBusyId(id);
    setError(null);
    try {
      if (action === "approve") await approve({ requestId: id });
      else await reject({ requestId: id });
    } catch (err) {
      setError(errorMessage(err, "Could not save that decision."));
    } finally {
      setBusyId(null);
    }
  }

  async function decideChange(id: Id<"leaveRequests">, approveIt: boolean) {
    setBusyId(id);
    setError(null);
    try {
      await decideAmendment({ requestId: id, approve: approveIt });
    } catch (err) {
      setError(errorMessage(err, "Could not save that decision."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell
      title="Approvals"
      titleInfo={<InfoHint>Requests waiting on your decision.</InfoHint>}
    >

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Changes to leave that's already approved. Above the new-request
          queue on purpose: some of these are people mid-leave waiting to know
          whether to come in tomorrow. */}
      {amendments && amendments.length > 0 && (
        <div className="mb-8">
          <SectionTitle>Change requests</SectionTitle>
          <div className="space-y-3">
            {amendments.map((r) => (
              <Card key={r._id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1">
                      <TypeDot color={r.leaveTypeColor} />
                    </span>
                    <div>
                      <div className="font-medium text-foreground">
                        <Link
                          href={`/employees/${r.userId}`}
                          className="hover:underline"
                        >
                          {r.employeeName}
                        </Link>
                        <span className="ml-2 text-sm font-normal text-muted">
                          {r.leaveTypeName}
                        </span>
                      </div>
                      <div className="text-sm text-muted">
                        <span className="line-through">
                          {formatRange(r.startDate, r.endDate)} · {r.days}d
                        </span>
                        <span className="mx-1.5">→</span>
                        <span className="font-medium text-foreground">
                          {formatRange(
                            r.proposedStartDate!,
                            r.proposedEndDate!,
                          )}{" "}
                          · {r.proposedDays}d
                        </span>
                      </div>
                      {r.proposedReason && (
                        <div className="mt-1 text-sm text-muted">
                          “{r.proposedReason}”
                        </div>
                      )}
                      <BalanceNote balance={r.balance} outcome="if you approve" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === r._id}
                      onClick={() =>
                        void decideChange(r._id as Id<"leaveRequests">, false)
                      }
                      className="rounded-md border border-red-500/30 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                    >
                      Decline
                    </button>
                    <PrimaryButton
                      disabled={busyId === r._id}
                      onClick={() =>
                        askApprove(
                          r._id as Id<"leaveRequests">,
                          "amendment",
                          r.employeeName,
                          r.balance,
                        )
                      }
                    >
                      Approve change
                    </PrimaryButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {amendments && amendments.length > 0 && (
        <SectionTitle>New requests</SectionTitle>
      )}
      {pending === undefined ? (
        <Empty>Loading…</Empty>
      ) : pending.length === 0 ? (
        <Empty>All caught up. No pending requests.</Empty>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => (
            <Card key={r._id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1">
                    <TypeDot color={r.leaveTypeColor} />
                  </span>
                  <div>
                    {/* Deciding often means checking the person's record first
                        — their balance, what else they've booked. Going via the
                        directory to get there was a detour. */}
                    <div className="font-medium text-foreground">
                      <Link
                        href={`/employees/${r.userId}`}
                        className="hover:underline"
                      >
                        {r.employeeName}
                      </Link>
                      <span className="ml-2 text-sm font-normal text-muted">
                        {r.leaveTypeName}
                      </span>
                    </div>
                    <div className="text-sm text-muted">
                      {formatRange(r.startDate, r.endDate)} · {r.days} working
                      day{r.days === 1 ? "" : "s"}
                      {halfLabel(r) && (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                          {halfLabel(r)}
                        </span>
                      )}
                    </div>
                    {r.note && (
                      <div className="mt-1 text-sm text-muted">“{r.note}”</div>
                    )}
                    <BalanceNote balance={r.balance} outcome="if you approve" />
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
                <div className="flex gap-2">
                  <button
                    disabled={busyId === r._id}
                    onClick={() =>
                      void decide(r._id as Id<"leaveRequests">, "reject")
                    }
                    className="rounded-md border border-red-500/30 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    Reject
                  </button>
                  <PrimaryButton
                    disabled={busyId === r._id}
                    onClick={() =>
                      askApprove(
                        r._id as Id<"leaveRequests">,
                        "request",
                        r.employeeName,
                        r.balance,
                      )
                    }
                  >
                    Approve
                  </PrimaryButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NegativeBalanceModal
        pending={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmApprove}
      />
    </AppShell>
  );
}
