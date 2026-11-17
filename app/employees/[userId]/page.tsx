"use client";

import { useState, useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  startImpersonation,
  useImpersonatedUserId,
  useEffectiveRole,
} from "@/lib/impersonation";
import { AppShell } from "@/components/AppShell";
import { InlineEdit, InlineSelect } from "@/components/InlineEdit";
import {
  Card,
  SectionTitle,
  StatusPill,
  TypeDot,
  Empty,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
import { formatRange, formatDay, formatLateness, halfLabel } from "@/lib/dates";
import { Modal } from "@/components/Modal";
import {
  Balance,
  BalanceNote,
  NegativeBalanceModal,
  goesNegative,
} from "@/components/BalanceWarning";
import { InfoHint } from "@/components/InfoHint";
import { RequestForm } from "@/components/RequestForm";
import { LatenessForm } from "@/components/LatenessForm";
import { DatePicker } from "@/components/DatePicker";
import { actionLabel, formatTime } from "@/lib/activity";
import type { FunctionReturnType } from "convex/server";

const selectCls =
  "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-foreground";
const roCls = "text-sm text-foreground";
// Delete stays out of the way until you're actually on the row — these get
// read far more often than they get pruned. Focus reveals it too, so it's
// still reachable without a mouse.
const deleteCls =
  "opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-red-400";

const REVISABLE = ["approved", "rejected", "cancelled", "pending"] as const;

// The status pill on a past request, made editable. Admins land here when a
// decision needs undoing — the balance correction and the note trail are the
// mutation's job, so this only has to collect the new status and the why.
function ReviseStatus({
  requestId,
  status,
  summary,
  startDate,
  endDate,
  startHalf,
  endHalf,
  halfPeriod,
}: {
  requestId: Id<"leaveRequests">;
  status: string;
  summary: string;
  startDate: string;
  endDate: string;
  startHalf?: boolean;
  endHalf?: boolean;
  halfPeriod?: "morning" | "afternoon";
}) {
  const revise = useMutation(api.leave.revise);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<string>(status);
  const [from, setFrom] = useState(startDate);
  const [to, setTo] = useState(endDate);
  const [half1, setHalf1] = useState(startHalf ?? false);
  const [half2, setHalf2] = useState(endHalf ?? false);
  const [period, setPeriod] = useState<"morning" | "afternoon">(
    halfPeriod ?? "morning",
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Whether the range the admin has dialled in is one day — drives which
  // half-day control to show, the same way the request form does it.
  const single = from === to;
  const changed =
    next !== status ||
    from !== startDate ||
    to !== endDate ||
    half1 !== (startHalf ?? false) ||
    (!single && half2 !== (endHalf ?? false)) ||
    (single && half1 && period !== halfPeriod);

  async function save() {
    setBusy(true);
    try {
      await revise({
        requestId,
        status: next as (typeof REVISABLE)[number],
        startDate: from,
        endDate: to,
        startHalf: half1,
        endHalf: single ? false : half2,
        halfPeriod: single && half1 ? period : undefined,
        reason: reason.trim() || undefined,
      });
      setOpen(false);
    } catch (err) {
      alert(errorMessage(err, "Could not change this request."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNext(status);
          setFrom(startDate);
          setTo(endDate);
          setHalf1(startHalf ?? false);
          setHalf2(endHalf ?? false);
          setPeriod(halfPeriod ?? "morning");
          setReason("");
          setOpen(true);
        }}
        title="Change this decision"
        className="rounded-full transition-opacity hover:opacity-70"
      >
        <StatusPill status={status} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change status"
        titleHint={
          <InfoHint width="w-72">
            Goes into this person&apos;s notes with your name, so whoever opens
            the profile next can see what happened. Their balance is corrected
            automatically. They aren&apos;t notified — tell them yourself if it
            matters.
          </InfoHint>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">{summary}</p>

          <div className="flex flex-wrap gap-2">
            {REVISABLE.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setNext(s)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  next === s
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted hover:bg-muted-bg"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                From
              </label>
              <DatePicker value={from} onChange={setFrom} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                To
              </label>
              <DatePicker value={to} min={from} onChange={setTo} />
            </div>
            <p className="col-span-2 -mt-1 text-xs text-muted">
              Moving the dates re-counts the working days against their
              country&apos;s calendar and adjusts the balance by the difference.
            </p>
          </div>

          {/* Half-days. The person says they took 1.5 days, not 2 — this is
              where that gets recorded, and the half comes back to their
              balance the same way a date move would. */}
          {single ? (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={half1}
                  onChange={(e) => setHalf1(e.target.checked)}
                  className="accent-accent"
                />
                Half day
              </label>
              {half1 && (
                <div className="mt-2 flex gap-2">
                  {(["morning", "afternoon"] as const).map((p) => (
                    <button
                      type="button"
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`rounded-md border px-3 py-1 text-sm capitalize transition-colors ${
                        period === p
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-muted hover:bg-card"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 rounded-md border border-border p-3 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={half1}
                  onChange={(e) => setHalf1(e.target.checked)}
                  className="accent-accent"
                />
                First day is a half day
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={half2}
                  onChange={(e) => setHalf2(e.target.checked)}
                  className="accent-accent"
                />
                Last day is a half day
              </label>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Why (optional)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. approved by mistake, dates clash with cover"
              className={`w-full ${selectCls}`}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setOpen(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton disabled={!changed || busy} onClick={() => void save()}>
              Save change
            </PrimaryButton>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function MemberDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId as Id<"users">;
  const router = useRouter();
  const year = new Date().getUTCFullYear();

  // Back link points wherever the profile was opened from (?from=…), read on the
  // client to avoid needing a Suspense boundary. Defaults to the directory.
  const [fromParam, setFromParam] = useState<string | null>(null);
  useEffect(() => {
    setFromParam(new URLSearchParams(window.location.search).get("from"));
  }, []);
  const back =
    fromParam === "calendar"
      ? { href: "/calendar", label: "Calendar" }
      : fromParam === "dashboard"
        ? { href: "/", label: "Dashboard" }
        : { href: "/employees", label: "Directory" };

  const me = useQuery(api.users.me);
  const asUserId = useImpersonatedUserId();
  const role = useEffectiveRole();
  const canEdit = role === "admin" || role === "superadmin";
  const [addLeaveOpen, setAddLeaveOpen] = useState(false);
  const isApprover = canEdit || role === "office_manager";

  const profile = useQuery(api.users.memberProfile, { userId });
  const balances = useQuery(api.allowances.forUser, { userId });
  const historyCycles = useQuery(api.leave.historyCyclesForUser, { userId });
  const approve = useMutation(api.leave.approve);
  const reject = useMutation(api.leave.reject);
  const decideAmendment = useMutation(api.leave.decideAmendment);
  const lateness = useQuery(api.lateness.forUser, { userId });
  // The cycles arrive newest-period-first and each is already ordered by leave
  // date, and periods don't overlap — so flattening gives the whole history in
  // date order for the "waiting on you" lists below.
  const history = historyCycles
    ? historyCycles.cycles.flatMap((c) => c.requests)
    : undefined;
  const currentCycle = historyCycles?.cycles.find((c) => c.isCurrent);
  const pastCycles = (historyCycles?.cycles ?? []).filter((c) => !c.isCurrent);
  // Anything of theirs still waiting on a decision. Derived from the history
  // we already load rather than a second query — the profile is where you end
  // up when deciding, so the decision belongs here too, not only in the queue.
  const awaitingDecision = (history ?? []).filter(
    (r) => r.status === "pending",
  );
  const awaitingChange = (history ?? []).filter(
    (r) => r.amendmentStatus === "pending",
  );
  const [decideBusyId, setDecideBusyId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<{
    balance: NonNullable<Balance>;
    name: string;
    run: () => Promise<unknown>;
    id: string;
  } | null>(null);

  async function runDecision(id: string, fn: () => Promise<unknown>) {
    setDecideBusyId(id);
    setDecideError(null);
    try {
      await fn();
    } catch (err) {
      setDecideError(errorMessage(err, "Could not save that decision."));
    } finally {
      setDecideBusyId(null);
    }
  }

  // Approving from the profile goes through the same gate as the queue: one
  // click normally, one dialog when it takes the person below zero.
  function askApprove(
    id: string,
    balance: Balance,
    name: string,
    run: () => Promise<unknown>,
  ) {
    if (goesNegative(balance)) {
      setConfirming({ balance, name, run, id });
      return;
    }
    void runDecision(id, run);
  }

  // Notes are admin-only; office managers don't see or write them.
  const notes = useQuery(
    api.notes.forMember,
    canEdit ? { memberUserId: userId } : "skip",
  );
  const people = useQuery(api.users.list, isApprover ? { asUserId: asUserId ?? undefined } : "skip");
  const departments = useQuery(api.departments.list);
  const countries = useQuery(api.countries.list);

  const setName = useMutation(api.users.setName);
  const setHiddenFromRoster = useMutation(api.users.setHiddenFromRoster);
  const setTitle = useMutation(api.users.setTitle);
  const setEmail = useMutation(api.users.setEmail);
  const setPhone = useMutation(api.users.setPhone);
  const setTeam = useMutation(api.users.setTeam);
  const setStartDate = useMutation(api.users.setStartDate);
  const assign = useMutation(api.users.assign);
  const setCountry = useMutation(api.users.setCountry);
  const setActive = useMutation(api.users.setActive);
  const setSignInAccess = useMutation(api.users.setSignInAccess);
  const setOverride = useMutation(api.allowances.setOverride);
  const setExtraDays = useMutation(api.allowances.setExtraDays);
  const addNote = useMutation(api.notes.add);
  const removeNote = useMutation(api.notes.remove);
  const removeLateness = useMutation(api.lateness.remove);
  const logImpersonationStart = useMutation(api.users.logImpersonationStart);

  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteKind, setNoteKind] = useState<"note" | "late">("note");
  // Null until someone picks a tab, so the default can follow the data: land on
  // Past cycles when the current one is empty. Otherwise the person whose cycle
  // just rolled over — the case that sent you here — opens to a blank card.
  const [historyTab, setHistoryTab] = useState<"current" | "past" | null>(null);
  const tab =
    historyTab ??
    (currentCycle?.requests.length === 0 && pastCycles.length > 0
      ? "past"
      : "current");

  if (me && !isApprover) {
    return (
      <AppShell>
        <Empty>Admins only.</Empty>
      </AppShell>
    );
  }
  if (profile === undefined) {
    return (
      <AppShell>
        <Empty>Loading…</Empty>
      </AppShell>
    );
  }
  if (profile === null) {
    return (
      <AppShell>
        <Empty>Person not found.</Empty>
      </AppShell>
    );
  }

  const approvers = (people ?? []).filter((p) => p.role !== "member");
  // Notes and late arrivals are one timeline. A late arrival is a note the app
  // writes for you — it needs no decision and touches no balance — and a card
  // of its own was a lot of chrome for one line of text. Ordered by the day the
  // thing happened, so a note written today sits above last month's lateness.
  const timeline = [
    ...(notes ?? []).map((n) => ({
      kind: "note" as const,
      id: n._id as string,
      at: n.createdAt,
      body: n.body,
      author: n.authorName ?? "Admin",
      noteId: n._id,
    })),
    ...(lateness ?? []).map((l) => ({
      kind: "lateness" as const,
      id: l._id as string,
      at: Date.parse(`${l.date}T00:00:00Z`),
      date: l.date,
      minutes: l.minutes,
      reason: l.reason,
      latenessId: l._id,
    })),
  ].sort((a, b) => b.at - a.at);
  const periodLabel = balances?.label ?? String(year);
  // Overrides are keyed by the leave period (calendar year for IE, anniversary
  // year for TR), so writes must target the same bucket the balances came from.
  const periodYear = balances?.periodYear ?? year;
  const deducting = (balances?.balances ?? []).filter(
    (b) => b.deductsAllowance,
  );
  const unlimited = (balances?.balances ?? []).filter(
    (b) => !b.deductsAllowance,
  );

  // What the last reset did to this person's statutory balance. Only the
  // statutory type rolls over, so there's at most one note to write.
  const carryNote = (() => {
    const annualId = balances?.annualLeaveTypeId;
    const annual = deducting.find((b) => b.leaveTypeId === annualId);
    const carried = annual?.breakdown?.carriedInDays ?? 0;
    const forfeited = annual?.breakdown?.forfeitedDays ?? 0;
    if (!carried && !forfeited) return null;
    // A negative carry is the previous year closing under zero. Nothing is
    // forfeited in that case, so it's the whole note.
    if (carried < 0) {
      const owed = Math.abs(carried);
      return `${owed} day${owed === 1 ? "" : "s"} overdrawn in the previous leave year, taken off this period's total.`;
    }
    const parts = [];
    if (carried) parts.push(`${carried} day${carried === 1 ? "" : "s"} carried over from the previous leave year`);
    if (forfeited) parts.push(`${forfeited} day${forfeited === 1 ? "" : "s"} went untaken and expired`);
    return `${parts.join(", and ")}.`;
  })();

  async function actAs() {
    try {
      await logImpersonationStart({ targetUserId: userId });
      startImpersonation(userId);
      router.push("/");
    } catch (err) {
      alert(errorMessage(err, "Could not act as this user."));
    }
  }

  return (
    <AppShell title={profile.name}>
      <Link
        href={back.href}
        className="mb-4 inline-block text-sm text-muted hover:text-foreground"
      >
        ← {back.label}
      </Link>

      {/* Header */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-lg font-semibold text-accent">
              {profile.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              {canEdit && profile.canManage ? (
                <InlineEdit
                  value={profile.name}
                  className="text-lg font-semibold text-foreground"
                  onSave={(v) => {
                    const n = v.trim();
                    if (n && n !== profile.name)
                      void setName({ profileId: profile._id, name: n }).catch(
                        (err) =>
                          alert(errorMessage(err, "Could not change the name.")),
                      );
                  }}
                />
              ) : (
                <div className="text-lg font-semibold text-foreground">
                  {profile.name}
                </div>
              )}
              <div className="text-sm text-muted">{profile.title || "—"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && profile.active && profile.canManage && (
              <PrimaryButton onClick={() => setAddLeaveOpen(true)}>
                Add leave
              </PrimaryButton>
            )}
            {canEdit && profile.canImpersonate && (
              <button
                onClick={() => void actAs()}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
              >
                Act as
              </button>
            )}
          </div>
        </div>

        {/* Admin direct entry — lands as approved, no approval round-trip. */}
        <Modal
          open={addLeaveOpen}
          onClose={() => setAddLeaveOpen(false)}
          title={`Add leave — ${profile.name}`}
        >
          <RequestForm
            adminDirect
            asUserId={userId}
            onDone={() => setAddLeaveOpen(false)}
          />
        </Modal>

        {/* Profile fields — editable for admins, read-only for office managers */}
        <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Field label="Email">
            {canEdit ? (
              <InlineEdit
                value={profile.email}
                type="email"
                placeholder="name@example.com"
                onSave={(v) => {
                  if (v.trim().toLowerCase() === profile.email) return;
                  setEmail({ profileId: profile._id, email: v }).catch((err) =>
                    alert(
                      err instanceof Error
                        ? err.message
                        : "Could not change the email.",
                    ),
                  );
                }}
              />
            ) : (
              <span className={roCls}>{profile.email}</span>
            )}
          </Field>
          <Field label="Phone">
            {canEdit ? (
              <InlineEdit
                value={profile.phone ?? ""}
                type="tel"
                placeholder="Add a phone…"
                onSave={(v) =>
                  void setPhone({ profileId: profile._id, phone: v })
                }
              />
            ) : (
              <span className={roCls}>{profile.phone || "—"}</span>
            )}
          </Field>
          <Field label="Job title">
            {canEdit ? (
              <InlineEdit
                value={profile.title ?? ""}
                placeholder="Add a title…"
                onSave={(v) =>
                  void setTitle({ profileId: profile._id, title: v })
                }
              />
            ) : (
              <span className={roCls}>{profile.title || "—"}</span>
            )}
          </Field>
          <Field label="Office">
            {canEdit ? (
              <InlineSelect
                value={profile.departmentId ?? ""}
                options={[
                  { value: "", label: "—" },
                  ...(departments ?? []).map((d) => ({
                    value: d._id as string,
                    label: d.name,
                  })),
                ]}
                onChange={(v) =>
                  void assign({
                    profileId: profile._id,
                    departmentId: v ? (v as Id<"departments">) : undefined,
                    managerId: profile.managerId,
                  })
                }
              />
            ) : (
              <span className={roCls}>{profile.departmentName ?? "—"}</span>
            )}
          </Field>
          <Field label="Department">
            {canEdit ? (
              <InlineEdit
                value={profile.team ?? ""}
                placeholder="Set department…"
                onSave={(v) =>
                  void setTeam({ profileId: profile._id, team: v })
                }
              />
            ) : (
              <span className={roCls}>{profile.team || "—"}</span>
            )}
          </Field>
          <Field label="Start date">
            {canEdit ? (
              <InlineEdit
                value={profile.startDate ?? ""}
                type="date"
                placeholder="Set start date…"
                onSave={(v) =>
                  void setStartDate({ profileId: profile._id, startDate: v })
                }
              />
            ) : (
              <span className={roCls}>{profile.startDate || "—"}</span>
            )}
          </Field>
          <Field label="Country">
            {canEdit ? (
              <InlineSelect
                value={profile.country ?? "IE"}
                options={(countries ?? []).map((c) => ({
                  value: c.code,
                  label: c.name,
                }))}
                onChange={(v) =>
                  void setCountry({ profileId: profile._id, country: v })
                }
              />
            ) : (
              <span className={roCls}>
                {countries?.find((c) => c.code === (profile.country ?? "IE"))
                  ?.name ?? profile.country}
              </span>
            )}
          </Field>
          <Field label="Approver">
            {canEdit ? (
              <InlineSelect
                value={profile.managerId ?? ""}
                options={[
                  { value: "", label: "office default" },
                  ...approvers.map((m) => ({
                    value: m.userId as string,
                    label: m.name,
                  })),
                ]}
                onChange={(v) =>
                  void assign({
                    profileId: profile._id,
                    departmentId: profile.departmentId,
                    managerId: v ? (v as Id<"users">) : undefined,
                  })
                }
              />
            ) : (
              <span className={roCls}>
                {profile.approverName ?? "office default"}
              </span>
            )}
          </Field>
        </div>
      </Card>

      {/* Waiting on you — only rendered when there IS something. An empty
          "no pending requests" card on every profile would be noise; this one
          appearing at all is the signal. */}
      {canEdit && (awaitingDecision.length > 0 || awaitingChange.length > 0) && (
        <Card className="mb-6 border-accent/40">
          <SectionTitle>Waiting on you</SectionTitle>
          {decideError && (
            <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {decideError}
            </p>
          )}
          <div className="space-y-3">
            {awaitingChange.map((r) => (
              <div
                key={`amend-${r._id}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-1">
                    <TypeDot color={r.leaveTypeColor} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {r.leaveTypeName}
                      <span className="ml-2 text-xs font-normal text-muted">
                        change requested
                      </span>
                    </div>
                    <div className="text-sm text-muted">
                      <span className="line-through">
                        {formatRange(r.startDate, r.endDate)} · {r.days}d
                      </span>
                      <span className="mx-1.5">→</span>
                      <span className="font-medium text-foreground">
                        {formatRange(
                          r.proposedStartDate ?? r.startDate,
                          r.proposedEndDate ?? r.endDate,
                        )}
                        {r.proposedDays !== undefined
                          ? ` · ${r.proposedDays}d`
                          : ""}
                      </span>
                    </div>
                    {r.proposedReason && (
                      <div className="mt-0.5 text-sm text-muted">
                        “{r.proposedReason}”
                      </div>
                    )}
                    <BalanceNote balance={r.balance} outcome="if you approve" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={decideBusyId === r._id}
                    onClick={() =>
                      void runDecision(r._id, () =>
                        decideAmendment({ requestId: r._id, approve: false }),
                      )
                    }
                    className="rounded-md border border-red-500/30 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    Decline
                  </button>
                  <PrimaryButton
                    disabled={decideBusyId === r._id}
                    onClick={() =>
                      askApprove(r._id, r.balance, profile.name, () =>
                        decideAmendment({ requestId: r._id, approve: true }),
                      )
                    }
                  >
                    Approve change
                  </PrimaryButton>
                </div>
              </div>
            ))}

            {awaitingDecision.map((r) => (
              <div
                key={r._id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-1">
                    <TypeDot color={r.leaveTypeColor} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {r.leaveTypeName}
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
                      <div className="mt-0.5 text-sm text-muted">“{r.note}”</div>
                    )}
                    <BalanceNote balance={r.balance} outcome="if you approve" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={decideBusyId === r._id}
                    onClick={() =>
                      void runDecision(r._id, () =>
                        reject({ requestId: r._id }),
                      )
                    }
                    className="rounded-md border border-red-500/30 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    Reject
                  </button>
                  <PrimaryButton
                    disabled={decideBusyId === r._id}
                    onClick={() =>
                      askApprove(r._id, r.balance, profile.name, () =>
                        approve({ requestId: r._id }),
                      )
                    }
                  >
                    Approve
                  </PrimaryButton>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Notes — written notes are admin-only; late arrivals print here too, so
          office managers get this card as their lateness log. */}
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-2 [&_h2]:mb-0">
          <SectionTitle>Notes</SectionTitle>
          <SecondaryButton
            onClick={() => {
              setNoteKind(canEdit ? "note" : "late");
              setNoteOpen(true);
            }}
          >
            {canEdit ? "Add note" : "Log late arrival"}
          </SecondaryButton>
        </div>

        {/* Composing happens in a modal — the field was permanently open for
            something written once in a while, and it pushed the notes down.
            A late arrival is the same act from the same place, so it's a toggle
            in here rather than a second button on the card. Office managers
            can't write notes, so they get the lateness form on its own. */}
        <Modal
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          title={`${canEdit ? "Add note" : "Log late arrival"} — ${profile.name}`}
        >
          {canEdit && (
            <div className="mb-4 flex gap-0.5 rounded-md border border-border p-0.5">
              {(
                [
                  ["note", "Note"],
                  ["late", "Late arrival"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNoteKind(key)}
                  aria-pressed={noteKind === key}
                  className={`flex-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    noteKind === key
                      ? "bg-muted-bg text-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {noteKind === "late" ? (
            <LatenessForm
              forUserId={userId}
              onDone={() => setNoteOpen(false)}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                void addNote({ memberUserId: userId, body: note });
                setNote("");
                setNoteOpen(false);
              }}
            >
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Add a note about this person…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground"
              />
              <div className="mt-4 flex justify-end gap-2">
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    setNote("");
                    setNoteOpen(false);
                  }}
                >
                  Cancel
                </SecondaryButton>
                <PrimaryButton type="submit" disabled={!note.trim()}>
                  Add note
                </PrimaryButton>
              </div>
            </form>
          )}
        </Modal>
        {timeline.length > 0 ? (
          <ul className="space-y-2">
            {timeline.map((item) =>
              item.kind === "note" ? (
                <li
                  key={item.id}
                  className="group rounded-md border border-border px-3 py-2"
                >
                  <div className="text-sm text-foreground">{item.body}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                    <span>
                      {item.author} ·{" "}
                      {new Date(item.at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <button
                      onClick={() => void removeNote({ noteId: item.noteId })}
                      className={deleteCls}
                    >
                      delete
                    </button>
                  </div>
                </li>
              ) : (
                // Self-reported, no decision attached — so it reads as a note
                // the app filed, not something anyone has to action.
                <li
                  key={item.id}
                  className="group rounded-md border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                      {formatLateness(item.minutes)} late
                    </span>
                    <span className="text-sm text-foreground">
                      {item.reason}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                    <span>Late arrival · {formatDay(item.date)}</span>
                    <button
                      onClick={() =>
                        void removeLateness({ entryId: item.latenessId })
                      }
                      className={deleteCls}
                    >
                      delete
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : (
          <Empty>{canEdit ? "No notes yet." : "No late arrivals logged."}</Empty>
        )}
      </Card>

      {/* Allowances */}
      <Card className="mb-6">
        <SectionTitle>Allowances · {periodLabel}</SectionTitle>
        {deducting.length === 0 ? (
          <Empty>No allowance-based leave types.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="py-1.5 pr-3 font-semibold">Type</th>
                <th className="py-1.5 pr-3 font-semibold">Base</th>
                <th className="py-1.5 pr-3 font-semibold">Carried</th>
                <th className="py-1.5 pr-3 font-semibold">Extra</th>
                <th className="py-1.5 pr-3 font-semibold">Total</th>
                <th className="py-1.5 pr-3 font-semibold">Taken</th>
                <th className="py-1.5 pr-3 font-semibold">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {deducting.map((b) => (
                <tr key={b.leaveTypeId} className="border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2 text-foreground">
                      <TypeDot color={b.color} />
                      {b.name}
                    </span>
                  </td>
                  {/* Editing "Base" sets the override, which deliberately
                      replaces the base alone — carried and extra days stay
                      stacked on top rather than being absorbed into it. */}
                  <td className="py-2 pr-3">
                    {canEdit ? (
                      <span className="flex items-center gap-2">
                        <InlineEdit
                          value={String(b.breakdown?.baseDays ?? b.totalDays)}
                          type="number"
                          className="w-16"
                          onSave={(v) =>
                            void setOverride({
                              userId,
                              leaveTypeId: b.leaveTypeId,
                              year: periodYear,
                              days: Math.max(0, Math.floor(Number(v) || 0)),
                            })
                          }
                        />
                        {b.overridden ? (
                          <button
                            onClick={() =>
                              void setOverride({
                                userId,
                                leaveTypeId: b.leaveTypeId,
                                year: periodYear,
                                days: null,
                              })
                            }
                            className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent hover:opacity-80"
                            title="Reset to the leave-type default"
                          >
                            override · reset
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted">default</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-foreground">
                        {b.breakdown?.baseDays ?? b.totalDays}
                      </span>
                    )}
                  </td>
                  {/* Carries both ways. Unused days roll in capped at the
                      leave type's limit; a period that closed under zero rolls
                      the whole overdraft in and reads as a debit against this
                      period's total. */}
                  <td
                    className={`py-2 pr-3 ${
                      (b.breakdown?.carriedInDays ?? 0) < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted"
                    }`}
                    title={
                      (b.breakdown?.carriedInDays ?? 0) < 0
                        ? "Overdrawn in the previous leave year. Those days were already taken, so they come off this period's total."
                        : b.breakdown?.carriedInDays
                          ? `Rolled over at the last reset. ${b.breakdown.carriedRemaining} of these are still unused — leave is booked against carried days first.`
                          : "Nothing rolled over into this period."
                    }
                  >
                    {b.breakdown?.carriedInDays
                      ? `${b.breakdown.carriedInDays > 0 ? "+" : "−"}${Math.abs(b.breakdown.carriedInDays)}`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {canEdit ? (
                      <InlineEdit
                        value={String(b.breakdown?.extraDays ?? 0)}
                        type="number"
                        className="w-16"
                        display={
                          b.breakdown?.extraDays
                            ? `+${b.breakdown.extraDays}`
                            : "—"
                        }
                        onSave={(v) => {
                          const n = Math.max(0, Math.floor(Number(v) || 0));
                          void setExtraDays({
                            userId,
                            leaveTypeId: b.leaveTypeId,
                            year: periodYear,
                            days: n === 0 ? null : n,
                          });
                        }}
                      />
                    ) : b.breakdown?.extraDays ? (
                      `+${b.breakdown.extraDays}`
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 font-medium text-foreground">
                    {b.totalDays}
                  </td>
                  <td className="py-2 pr-3 text-muted">{b.usedDays}</td>
                  <td className="py-2 pr-3 font-medium text-foreground">
                    {b.remainingDays}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {carryNote && (
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted">
            {carryNote}
          </p>
        )}
      </Card>

      {/* Unlimited (uncapped) types — tracked count only. The employee sees no
          balance for these; this section is the admin-only view. */}
      {unlimited.length > 0 && (
        <Card className="mb-6">
          <SectionTitle>Unlimited · {periodLabel}</SectionTitle>
          <p className="mb-3 text-xs text-muted">
            No balance is shown to the employee — they see an “unlimited” view.
            This is the internal tally.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="py-1.5 pr-3 font-semibold">Type</th>
                <th className="py-1.5 pr-3 font-semibold">Taken</th>
                <th className="py-1.5 pr-3 font-semibold">Internal cap</th>
              </tr>
            </thead>
            <tbody>
              {unlimited.map((b) => (
                <tr key={b.leaveTypeId} className="border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2 text-foreground">
                      <TypeDot color={b.color} />
                      {b.name}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-medium text-foreground">
                    {b.usedDays}
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {b.internalCap != null ? (
                      `${b.usedDays} / ${b.internalCap}`
                    ) : (
                      <span className="text-[10px]">no cap</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* History — one card, cut into leave cycles. The allowance card above
          only ever shows the cycle you're in, so the day a cycle rolls over a
          whole year of leave stops being counted anywhere on the page. Closed
          cycles collapse with their totals; that's the only place a finished
          year's "taken" is readable. */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 [&_h2]:mb-0">
          <SectionTitle>Leave history</SectionTitle>
          <div className="flex gap-0.5 rounded-md border border-border p-0.5">
            {(
              [
                ["current", "Current cycle"],
                ["past", `Past cycles${pastCycles.length ? ` · ${pastCycles.length}` : ""}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setHistoryTab(key)}
                aria-pressed={tab === key}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  tab === key
                    ? "bg-muted-bg text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {historyCycles === undefined ? (
          <Empty>Loading…</Empty>
        ) : tab === "current" ? (
          // No totals on this tab on purpose: the allowance card is the current
          // cycle's tally, and a second one could only ever disagree with it.
          !currentCycle || currentCycle.requests.length === 0 ? (
            <Empty>Nothing booked this cycle yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {currentCycle.requests.map((r) => (
                <HistoryRow key={r._id} request={r} canEdit={canEdit} />
              ))}
            </ul>
          )
        ) : pastCycles.length === 0 ? (
          <Empty>No earlier cycles yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {pastCycles.map((c) => (
              <CycleGroup key={c.periodYear} cycle={c} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </Card>

      {/* Access — the three ways to take something away. Each column is a
          verb and its button; the consequences, which used to run to a
          paragraph and a bullet list apiece, sit behind the (i). They matter
          when you're deciding, not every time you open the page. */}
      {canEdit && (
        <Card className="mt-6 border-red-500/30">
          <SectionTitle>Access</SectionTitle>
          <div className="grid gap-5 sm:grid-cols-3">
            {/* Visibility: takes nothing away from them, only from everyone
                else's view of them. First because it's the mildest. */}
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-muted">
                  Visibility
                </span>
                <InfoHint width="w-72">
                  {profile.hiddenFromRoster ? (
                    <>
                      {profile.name.split(" ")[0]} is hidden from the team
                      calendar, who&apos;s off today, headcount, office presence
                      and department rosters. They still book leave and keep
                      their balance as normal, and they stay in this employee
                      list.
                    </>
                  ) : (
                    <>
                      Hiding {profile.name.split(" ")[0]} keeps them out of the
                      team calendar, who&apos;s off today, headcount, office
                      presence and department rosters — for everyone. Their
                      leave and balance are untouched, and they stay in this
                      employee list so you can undo it. For accounts that belong
                      to the company rather than to a colleague.
                    </>
                  )}
                </InfoHint>
              </div>
              <SecondaryButton
                onClick={() =>
                  void setHiddenFromRoster({
                    profileId: profile._id,
                    hidden: !profile.hiddenFromRoster,
                  }).catch((err) =>
                    alert(errorMessage(err, "Could not change visibility.")),
                  )
                }
              >
                {profile.hiddenFromRoster
                  ? "Show in rosters"
                  : "Hide from rosters"}
              </SecondaryButton>
            </div>

            {/* Sign-in: reversible, and independent of employment. */}
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-muted">
                  Sign-in
                </span>
                <InfoHint width="w-72">
                  {profile.active ? (
                    profile.signInBlocked ? (
                      <>
                        {profile.name.split(" ")[0]} can&apos;t sign in. They
                        remain an active employee — still counted, still on the
                        calendar, and you can still book leave for them.
                      </>
                    ) : (
                      <>
                        Revoking sign-in stops {profile.name.split(" ")[0]}{" "}
                        using the app without offboarding them. They stay an
                        active employee, keep their allowance, and you can still
                        enter leave on their behalf.
                      </>
                    )
                  ) : (
                    <>Sign-in is already revoked — offboarding does that too.</>
                  )}
                </InfoHint>
              </div>
              {profile.active ? (
                profile.signInBlocked ? (
                  <PrimaryButton
                    onClick={() =>
                      setSignInAccess({
                        profileId: profile._id,
                        allowed: true,
                      }).catch((err) =>
                        alert(
                          err instanceof Error
                            ? err.message
                            : "Could not restore sign-in.",
                        ),
                      )
                    }
                  >
                    Restore sign-in
                  </PrimaryButton>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setSignInAccess({
                        profileId: profile._id,
                        allowed: false,
                      }).catch((err) =>
                        alert(
                          err instanceof Error
                            ? err.message
                            : "Could not revoke sign-in.",
                        ),
                      )
                    }
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg"
                  >
                    Revoke sign-in
                  </button>
                )
              ) : null}
            </div>

            {/* Offboarding: the one that ends participation. */}
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-muted">
                  Offboarding
                </span>
                <InfoHint width="w-72">
                  {profile.active ? (
                    <>
                      Offboarding {profile.name.split(" ")[0]} ends their
                      participation but keeps their record — balances, leave
                      history and notes all stay, and they still appear in past
                      reports. They can no longer book leave (nor can you on
                      their behalf), log a late arrival, or sign in, and they
                      drop out of headcount, office presence, the team roster
                      and the directory unless you filter to Offboarded.
                    </>
                  ) : (
                    <>
                      {profile.name.split(" ")[0]} is offboarded. Reinstating
                      restores everything as it was — including the original
                      start date, so tenure counts straight through the gap. If
                      they rejoined as a new hire, set a new start date
                      afterwards.
                    </>
                  )}
                </InfoHint>
              </div>
              {profile.active ? (
                profile.approvesForPeople + profile.approvesForOffices > 0 ? (
                  <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    {profile.name.split(" ")[0]} approves leave for{" "}
                    {profile.approvesForPeople > 0 && (
                      <strong>
                        {profile.approvesForPeople}{" "}
                        {profile.approvesForPeople === 1 ? "person" : "people"}
                      </strong>
                    )}
                    {profile.approvesForPeople > 0 &&
                      profile.approvesForOffices > 0 &&
                      " and "}
                    {profile.approvesForOffices > 0 && (
                      <strong>
                        {profile.approvesForOffices}{" "}
                        {profile.approvesForOffices === 1 ? "office" : "offices"}
                      </strong>
                    )}
                    . Reassign them first, or their requests would have nobody
                    to go to.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `Offboard ${profile.name}? Their record is kept and you can reinstate them later.`,
                        )
                      )
                        setActive({
                          profileId: profile._id,
                          active: false,
                        }).catch((err) =>
                          alert(
                            err instanceof Error
                              ? err.message
                              : "Could not offboard.",
                          ),
                        );
                    }}
                    className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                  >
                    Offboard {profile.name.split(" ")[0]}
                  </button>
                )
              ) : (
                <PrimaryButton
                  onClick={() =>
                    void setActive({ profileId: profile._id, active: true })
                  }
                >
                  Reinstate {profile.name.split(" ")[0]}
                </PrimaryButton>
              )}
            </div>
          </div>
        </Card>
      )}
      <NegativeBalanceModal
        pending={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          const { id, run } = confirming;
          setConfirming(null);
          void runDecision(id, run);
        }}
      />
    </AppShell>
  );
}

// One profile row: label in a fixed left column so every control on the card
// starts at the same x, whatever the label's length.
type HistoryCycle = FunctionReturnType<
  typeof api.leave.historyCyclesForUser
>["cycles"][number];
type HistoryEntry = HistoryCycle["requests"][number];

// One closed leave cycle, collapsed to its totals. Expanding it is how you
// answer "what did they take that year" now that the balance card has moved on
// to the next cycle. Rows are fetched with the rest of the history, so opening
// one costs nothing.
function CycleGroup({
  cycle,
  canEdit,
}: {
  cycle: HistoryCycle;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {cycle.label}
          </div>
          {/* The totals are the reason this row exists, so they carry the
              type's colour and the weight — the label around them is context. */}
          {cycle.totals.length === 0 ? (
            <div className="text-xs text-muted">No leave taken</div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {cycle.totals.map((t) => (
                <span
                  key={t.leaveTypeId}
                  className="flex items-center gap-1.5 text-xs text-muted"
                >
                  <TypeDot color={t.color} />
                  {t.name}
                  <span className="text-sm font-semibold text-foreground">
                    {t.days}d
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        {/* No headline number here: with one deducting type it only repeats
            the breakdown, and summing paid against unpaid days would invent a
            total nobody asked for. */}
      </button>

      {open && (
        <ul className="space-y-2 border-t border-border p-3">
          {cycle.requests.map((r) => (
            <HistoryRow key={r._id} request={r} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </li>
  );
}

// One row of the leave history. Collapsed it's the same one-liner as before;
// expanded it answers "who did what to this, and when" from the audit trail —
// the questions that used to mean opening the activity log and hunting.
// The trail is fetched only on expand, so a long history costs nothing to show.
function HistoryRow({
  request: r,
  canEdit,
}: {
  request: HistoryEntry;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const events = useQuery(
    api.leave.eventsForRequest,
    open ? { requestId: r._id } : "skip",
  );

  return (
    <li className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <TypeDot color={r.leaveTypeColor} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {r.leaveTypeName}
            </div>
            <div className="text-xs text-muted">
              {formatRange(r.startDate, r.endDate)} · {r.days}d
              {halfLabel(r) ? ` · ${halfLabel(r)}` : ""}
              {r.documentId ? " · 📎" : ""}
            </div>
          </div>
        </button>
        {canEdit ? (
          <ReviseStatus
            requestId={r._id}
            status={r.status}
            summary={`${r.leaveTypeName} · ${formatRange(r.startDate, r.endDate)}`}
            startDate={r.startDate}
            endDate={r.endDate}
            startHalf={r.startHalf}
            endHalf={r.endHalf}
            halfPeriod={r.halfPeriod}
          />
        ) : (
          <StatusPill status={r.status} />
        )}
      </div>

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs">
          {r.note && (
            <Detail label="Reason">
              <span className="text-foreground">{r.note}</span>
            </Detail>
          )}
          {r.decidedAt && (
            <Detail label={r.status === "rejected" ? "Rejected" : "Decided"}>
              <span className="text-foreground">
                {r.approvedByName ?? "Unknown"} · {formatTime(r.decidedAt)}
              </span>
              {r.decisionNote ? (
                <div className="text-muted">“{r.decisionNote}”</div>
              ) : null}
            </Detail>
          )}
          {r.amendmentStatus === "pending" && (
            <Detail label="Change requested">
              <span className="text-foreground">
                {formatRange(
                  r.proposedStartDate ?? r.startDate,
                  r.proposedEndDate ?? r.endDate,
                )}
                {r.proposedDays !== undefined ? ` · ${r.proposedDays}d` : ""}
              </span>
              {r.proposedReason ? (
                <div className="text-muted">“{r.proposedReason}”</div>
              ) : null}
            </Detail>
          )}
          {r.documentUrl && (
            <Detail label="Document">
              <a
                href={r.documentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                📎 {r.documentName ?? "document"}
              </a>
            </Detail>
          )}

          <Detail label="Trail">
            {events === undefined ? (
              <span className="text-muted">Loading…</span>
            ) : events.length === 0 ? (
              <span className="text-muted">
                No recorded actions — this predates the activity log.
              </span>
            ) : (
              <ol className="space-y-1">
                {events.map((e) => (
                  <li key={e._id} className="text-foreground">
                    <span className="font-medium">{e.actorName}</span>{" "}
                    {actionLabel(e.action)}
                    {e.impersonatedName
                      ? ` (acting as ${e.impersonatedName})`
                      : ""}
                    <span className="text-muted"> · {formatTime(e.timestamp)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Detail>
        </div>
      )}
    </li>
  );
}

// Label/value pair inside an expanded history row.
function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <span className="text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}
