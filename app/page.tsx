"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, SectionTitle, StatusPill, TypeDot, Empty } from "@/components/ui";
import { InfoHint } from "@/components/InfoHint";
import { formatRange, formatRangeCompact, formatDay } from "@/lib/dates";
import {
  useImpersonatedUserId,
  useEffectiveRole,
} from "@/lib/impersonation";
import {
  useSortedRows,
  SortableTh,
  type SortAccessors,
} from "@/components/SortableTable";

// "Monday, 3 August" — the dashboard's title. It used to greet you by name with
// the date tucked behind an (i), which is a silly place for a date: you read it
// at a glance or not at all, and a greeting says nothing the sidebar doesn't.
function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// "2 yrs", "5 mos", "1 yr 3 mos" — how long they've been with the company.
function tenureLabel(startISO: string): string {
  const start = new Date(`${startISO}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return "";
  const now = new Date();
  let months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) return "";
  if (months < 1) return "just joined";
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  const parts: string[] = [];
  if (yrs > 0) parts.push(`${yrs} yr${yrs > 1 ? "s" : ""}`);
  if (mos > 0) parts.push(`${mos} mo${mos > 1 ? "s" : ""}`);
  return parts.join(" ");
}

export default function Dashboard() {
  const me = useQuery(api.users.me);
  const impersonatedId = useImpersonatedUserId();
  const actingAs = useQuery(
    api.users.getById,
    impersonatedId ? { userId: impersonatedId } : "skip",
  );
  // Acting as an admin shows the admin dashboard — the point of impersonation
  // is to see their view, and theirs is the management one.
  const role = impersonatedId ? actingAs?.role : me?.role;
  const isAdminView = role === "admin" || role === "superadmin";

  if (impersonatedId && actingAs === undefined) {
    return (
      <AppShell>
        <Empty>Loading…</Empty>
      </AppShell>
    );
  }
  if (me && isAdminView) {
    return (
      <AdminDashboard
        name={(impersonatedId ? actingAs?.name : me.name) ?? me.name}
        asUserId={impersonatedId ?? undefined}
      />
    );
  }
  return <PersonalDashboard asUserId={impersonatedId ?? undefined} me={me} />;
}

type Balance = NonNullable<
  ReturnType<typeof useQuery<typeof api.allowances.myAllowance>>
>["balances"][number];

// One leave type's standing for the viewer: days left for capped types, days
// taken for uncapped ones. Shared by the personal and admin dashboards.
function BalanceCard({ b }: { b: Balance }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-1.5">
        <TypeDot color={b.color} />
        <span className="text-xs font-medium text-muted">{b.name}</span>
      </div>
      {b.deductsAllowance ? (
        <>
          <div className="text-2xl font-semibold text-foreground">
            {b.remainingDays}
            <span className="text-sm font-normal text-muted">
              {" "}
              / {b.totalDays}
            </span>
          </div>
          <div className="text-xs text-muted">days left</div>
        </>
      ) : (
        <>
          <div className="text-2xl font-semibold text-foreground">
            {b.usedDays}
          </div>
          {/* Just the direction of the number — "unlimited" is the admin's
              config detail, not something the person taking a day cares about. */}
          <div className="text-xs text-muted">days taken</div>
        </>
      )}
    </Card>
  );
}

function PersonalDashboard({
  asUserId,
  me,
}: {
  asUserId?: string;
  me: ReturnType<typeof useQuery<typeof api.users.me>>;
}) {
  const balances = useQuery(api.allowances.myAllowance, { asUserId: asUserId as any });
  const myRequests = useQuery(api.leave.myRequests, { asUserId: asUserId as any });
  const overview = useQuery(api.users.myOverview, { asUserId: asUserId as any });
  const target = useQuery(
    api.users.getById,
    asUserId ? { userId: asUserId as any } : "skip",
  );

  // Office managers get a team section on their dashboard — including when an
  // admin is acting as them, since the point is to see their view. Both
  // queries return [] for non-approvers.
  const isOM = (asUserId ? target?.role : me?.role) === "office_manager";
  const teamOffToday = useQuery(api.leave.offTodayScoped, {
    asUserId: asUserId as any,
  });
  const teamPending = useQuery(api.leave.pendingApprovals, {
    asUserId: asUserId as any,
  });

  const upcoming = (myRequests ?? [])
    .filter((r) => r.status === "approved" || r.status === "pending")
    .slice(0, 5);

  return (
    <AppShell title={todayLabel()}>

      {overview && (overview.startDate || overview.departmentName) && (
        <div className="card mb-6 flex flex-wrap gap-x-10 gap-y-3 p-4">
          {overview.startDate && (
            <div>
              <div className="text-xs text-muted">Started</div>
              <div className="text-sm font-medium text-foreground">
                {formatDay(overview.startDate)}
                {tenureLabel(overview.startDate) && (
                  <span className="font-normal text-muted">
                    {" "}
                    · {tenureLabel(overview.startDate)}
                  </span>
                )}
              </div>
            </div>
          )}
          {overview.departmentName && (
            <div>
              <div className="text-xs text-muted">Office</div>
              <div className="text-sm font-medium text-foreground">
                {overview.departmentName}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 className="text-lg font-semibold text-foreground">Leave year</h2>
          <span className="text-base text-muted">
            {balances?.label ?? new Date().getUTCFullYear()}
          </span>
        </div>
        {/* Same auto-fit grid as the admin dashboard's — the number of leave
            types varies by country, and the row should always fill its width. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
          {balances?.balances.map((b) => (
            <BalanceCard key={b.leaveTypeId} b={b} />
          ))}
          {balances && balances.balances.length === 0 && (
            <div className="col-span-full">
              <Empty>No leave types configured yet.</Empty>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Upcoming &amp; pending</SectionTitle>
            <Link
              href="/requests"
              className="text-sm font-medium text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <Empty>Nothing booked. Time to plan a break?</Empty>
          ) : (
            <ul className="-mt-1 divide-y divide-border">
              {upcoming.map((r) => (
                <li
                  key={r._id}
                  className="flex items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <TypeDot color={r.leaveTypeColor} />
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {r.leaveTypeName}
                      </div>
                      <div className="text-xs text-muted">
                        {formatRange(r.startDate, r.endDate)} · {r.days}d
                      </div>
                    </div>
                  </div>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Quick actions</SectionTitle>
          <div className="space-y-2">
            <Link
              href="/requests"
              className="block rounded-md bg-accent px-4 py-3 text-center text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Request leave
            </Link>
            <Link
              href="/calendar"
              className="block rounded-md border border-border px-4 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted-bg"
            >
              See who is off
            </Link>
          </div>
        </Card>
      </div>

      {isOM && (
        <div className="mt-8 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Your team</h2>
            <p className="text-sm text-muted">
              Coverage and leave for the people you approve.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>Off today</SectionTitle>
                <Link
                  href="/calendar"
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Calendar
                </Link>
              </div>
              {teamOffToday === undefined ? (
                <Empty>Loading…</Empty>
              ) : teamOffToday.length === 0 ? (
                <Empty>Everyone is in today.</Empty>
              ) : (
                <ul className="-mt-1 divide-y divide-border">
                  {teamOffToday.map((r) => (
                    <li
                      key={r._id}
                      className="flex items-center gap-2 py-2.5 text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {r.employeeName}
                      </span>
                      {r.approvedByName && (
                        <span className="text-xs text-muted">
                          · approved by {r.approvedByName}
                        </span>
                      )}
                      <span
                        className="ml-auto flex min-w-[12rem] items-center gap-1.5 text-xs text-muted"
                        title={r.leaveTypeName}
                      >
                        <TypeDot color={r.leaveTypeColor} />
                        {formatRange(r.startDate, r.endDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium text-muted">
                Pending approvals
              </div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {teamPending?.length ?? "—"}
              </div>
              <Link
                href="/approvals"
                className="text-xs font-medium text-accent hover:underline"
              >
                Review
              </Link>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// One number + where to act on it. The dashboard is KPIs and today's work,
// nothing that scrolls. The whole card is the link — a printed link naming a
// tab the sidebar already shows was saying it twice, and "Review" under a 0
// was an action offered exactly when there is nothing to act on. With no
// border to recolour, hover is a ring: it composes into the same box-shadow
// chain as the card's shadow, so both show at once.
function Kpi({
  label,
  value,
  href,
}: {
  label: string;
  value: React.ReactNode;
  // Omitted when the viewer can't reach the destination — an admin has no
  // directory to go to.
  href?: string;
}) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
    </>
  );
  if (!href) return <Card className="p-4">{body}</Card>;
  return (
    <Link
      href={href}
      className="card block p-4 outline-none transition-shadow hover:ring-1 hover:ring-accent focus-visible:ring-1 focus-visible:ring-accent"
    >
      {body}
    </Link>
  );
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Per-admin, per-browser preference persisted to localStorage. `key` may be
// null while the owning id (e.g. the admin's userId) is still loading — nothing
// is read or written until it resolves. Reloads when the key changes.
//
// Persistence happens ONLY in the returned setter (i.e. on a real user change),
// never in a value-watching effect — that avoids the load-vs-write race where a
// stale fallback would clobber the stored value right after a refresh. Returns
// `loaded` so callers can hold off on a default until storage has been read.
function useStoredState<T>(key: string | null, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    setLoaded(false);
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(key);
      setValue(raw !== null ? (JSON.parse(raw) as T) : fallback);
    } catch {
      setValue(fallback);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const next =
        typeof updater === "function"
          ? (updater as (prev: T) => T)(valueRef.current)
          : updater;
      valueRef.current = next;
      if (key) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage full / unavailable — preference just won't persist */
        }
      }
      setValue(next);
    },
    [key],
  );
  return [value, set, loaded] as const;
}

function AdminDashboard({
  name,
  asUserId,
}: {
  name: string;
  asUserId?: string;
}) {
  const as = { asUserId: asUserId as any };
  const pending = useQuery(api.leave.pendingApprovals, as);
  const offToday = useQuery(api.leave.offTodayScoped, as);
  // Admins are staff too, so their own standing sits alongside the management
  // view rather than only on My Leave.
  const myBalances = useQuery(api.allowances.myAllowance, as);
  // Headcount is a dashboard figure, so it counts the viewer's remit.
  const people = useQuery(api.users.list, { ...as, teamOnly: true });
  const countries = useQuery(api.countries.list);
  const me = useQuery(api.users.me);
  const isSuperadmin = useEffectiveRole() === "superadmin";
  const [q, setQ] = useState("");
  // Column/country prefs stay keyed to the real admin, not the person being
  // impersonated — they're this browser's preferences.
  const adminKey = me?.userId ?? null;

  // Both prefs persist per admin so they survive a fresh session.
  const [country, setCountry, countryLoaded] = useStoredState<string | null>(
    adminKey ? `dash:country:${adminKey}` : null,
    null,
  );
  // Hold off on the first-country default until the saved pick has been read,
  // so a stored choice doesn't flash past the alphabetical default.
  const activeCountry =
    country ?? (countryLoaded ? (countries?.[0]?.code ?? null) : null);
  const roster = useQuery(
    api.allowances.roster,
    activeCountry ? { country: activeCountry, ...as } : "skip",
  );

  const [selectedCols, setSelectedCols] = useStoredState<string[]>(
    adminKey && activeCountry
      ? `dash:cols:${adminKey}:${activeCountry}`
      : null,
    [],
  );

  // Base columns hide by exception (visible unless opted out); leave-type
  // columns show by selection. Name is identity and never toggleable.
  const [hiddenBase, setHiddenBase] = useStoredState<string[]>(
    adminKey && activeCountry
      ? `dash:hidecols:${adminKey}:${activeCountry}`
      : null,
    [],
  );
  const hiddenSet = new Set(hiddenBase);
  const showCol = (id: string) => !hiddenSet.has(id);
  function toggleBase(id: string) {
    setHiddenBase((current) =>
      current.includes(id)
        ? current.filter((i) => i !== id)
        : [...current, id],
    );
  }

  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!columnsOpen) return;
    function onDown(e: MouseEvent) {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [columnsOpen]);

  // The header search filters the team table — the only list on this page long
  // enough to need it. Name or office, same fields the directory matches on.
  const rosterNeedle = q.trim().toLowerCase();
  const rosterRows = (roster?.rows ?? []).filter((r) =>
    rosterNeedle
      ? `${r.name} ${r.office ?? ""}`.toLowerCase().includes(rosterNeedle)
      : true,
  );
  const otherTypes = roster?.otherTypes ?? [];
  const selectedSet = new Set(selectedCols);
  const columnTypes = otherTypes.filter((t) => selectedSet.has(t.leaveTypeId));

  function toggleColumn(leaveTypeId: string) {
    setSelectedCols((current) =>
      current.includes(leaveTypeId)
        ? current.filter((id) => id !== leaveTypeId)
        : [...current, leaveTypeId],
    );
  }

  const rosterAccessors: SortAccessors<(typeof rosterRows)[number]> = {
    name: (r) => r.name,
    office: (r) => r.office,
    tenure: (r) => r.startDate,
    reset: (r) => r.resetDate,
    annualTotal: (r) => r.annualTotal,
    annualUsed: (r) => r.annualUsed,
    annualLeft: (r) => r.annualRemaining,
    ...Object.fromEntries(
      columnTypes.map((t) => [
        `t_${t.leaveTypeId}`,
        (r: (typeof rosterRows)[number]) => r.taken[t.leaveTypeId] ?? 0,
      ]),
    ),
  };
  const {
    sorted: sortedRoster,
    sort: rosterSort,
    toggle: toggleRoster,
  } = useSortedRows(rosterRows, rosterAccessors, { key: "name", dir: "asc" });

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = addDaysISO(today, 6);
  const week = useQuery(api.leave.calendar, {
    fromDate: today,
    toDate: weekEnd,
    // Dashboard figures are about the viewer's own remit; superadmins still
    // get everyone.
    teamOnly: true,
    ...as,
  });

  const headcount = (people ?? []).filter(
    (p) =>
      (p.role === "member" || p.role === "office_manager") &&
      p.active &&
      p.status !== "pending" &&
      p.status !== "rejected",
  ).length;

  // One row per person for the week panel, soonest first.
  const weekRows = week
    ? [...week].sort((a, b) => a.startDate.localeCompare(b.startDate))
    : undefined;
  const offThisWeek = week ? new Set(week.map((r) => r.userId)).size : undefined;

  const urgent = pending
    ? [...pending]
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 5)
    : undefined;

  return (
    <AppShell title={todayLabel()} search={{ value: q, onChange: setQ }}>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Pending approvals"
          value={pending?.length ?? "—"}
          href="/approvals"
        />
        <Kpi
          label="Off today"
          value={offToday?.length ?? "—"}
          href="/calendar"
        />
        <Kpi
          label="Off this week"
          value={offThisWeek ?? "—"}
          href="/calendar"
        />
        <Kpi
          label={isSuperadmin ? "Active staff" : "Your team"}
          value={people ? headcount : "—"}
          href={isSuperadmin ? "/employees" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between [&_h2]:mb-0">
            <SectionTitle>Needs your decision</SectionTitle>
            {pending && pending.length > 0 && (
              <Link
                href="/approvals"
                className="text-sm font-medium text-accent hover:underline"
              >
                All {pending.length}
              </Link>
            )}
          </div>
          {urgent === undefined ? (
            <Empty>Loading…</Empty>
          ) : urgent.length === 0 ? (
            <Empty>All caught up. No pending requests.</Empty>
          ) : (
            <ul className="-mt-1 divide-y divide-border">
              {urgent.map((r) => (
                <li
                  key={r._id}
                  className="flex items-center gap-2 py-2.5 text-sm"
                >
                  <span className="font-medium text-foreground">
                    {r.employeeName}
                  </span>
                  {/* The dot is the leave type's colour, so it rides with the
                      type label, not the name. */}
                  <span className="flex items-center gap-1.5 text-muted">
                    <TypeDot color={r.leaveTypeColor} />
                    {r.leaveTypeName}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    {formatRangeCompact(r.startDate, r.endDate)} · {r.days}d
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Out this week</SectionTitle>
          {weekRows === undefined ? (
            <Empty>Loading…</Empty>
          ) : weekRows.length === 0 ? (
            <Empty>Everyone is in this week.</Empty>
          ) : (
            <ul className="-mt-1 divide-y divide-border">
              {weekRows.map((r) => (
                <li
                  key={r._id}
                  className="flex items-center gap-2 py-2.5 text-sm"
                >
                  <span className="font-medium text-foreground">
                    {r.employeeName}
                  </span>
                  {r.startDate <= today && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      out now
                    </span>
                  )}
                  {/* The dot colours the leave, not the person — it sits with
                      the stint, and the type name rides the hover. min-w makes
                      the cluster a shared column so the dots stack in a line
                      instead of raggedly tracking each row's date width. */}
                  <span
                    className="ml-auto flex min-w-[9rem] items-center gap-1.5 text-xs text-muted"
                    title={r.leaveTypeName}
                  >
                    <TypeDot color={r.leaveTypeColor} />
                    {formatRangeCompact(r.startDate, r.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* The admin's own leave. Sits below the management view — it's their
          data, but not why they opened this page. */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="text-lg font-semibold text-foreground">Your leave</h2>
            <span className="text-base text-muted">
              {myBalances?.label ?? new Date().getUTCFullYear()}
            </span>
          </div>
        </div>
        {myBalances && myBalances.balances.length === 0 ? (
          <Empty>No leave types configured for your country yet.</Empty>
        ) : (
          // Leave types are per-country, so the count varies (Ireland has 5,
          // Türkiye 4) and a fixed sm:grid-cols-4 always orphaned the fifth
          // onto its own row. 160px keeps the longest type names on one line.
          //
          // auto-FIT, not auto-fill: auto-fill keeps the empty tracks it made
          // room for, and a 1fr empty track still takes its share of the row —
          // so five cards in a six-track grid stopped short of the right edge
          // while the table below ran full width. auto-fit collapses the empty
          // ones and the cards stretch to fill.
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
            {myBalances?.balances.map((b) => (
              <BalanceCard key={b.leaveTypeId} b={b} />
            ))}
          </div>
        )}
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 [&_h2]:mb-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <SectionTitle>Team</SectionTitle>
            {roster?.annualType && (
              <InfoHint>
                <span className="font-medium">Allowance / Used / Left</span> ={" "}
                {roster.annualType.name} (paid time off). Columns after
                that show days taken this leave year — pick them with the columns
                button.
              </InfoHint>
            )}
            {countries && countries.length > 1 && (
              <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                {countries.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCountry(c.code)}
                    className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                      activeCountry === c.code
                        ? "bg-accent text-white"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Column picker anchors the right edge — the row had everything
              bunched left once the Directory link came out. A control that
              opens a menu and changes the table under it gets a border and a
              written label; every column except Name is toggleable. */}
          {roster && (
              <div ref={columnsRef} className="relative">
                <button
                  type="button"
                  onClick={() => setColumnsOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="3" y="3" width="7" height="18" rx="1" />
                    <rect x="14" y="3" width="7" height="18" rx="1" />
                  </svg>
                  Columns
                </button>
                {columnsOpen && (
                  <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-border bg-card p-1.5 shadow-lg">
                    {[
                      { id: "office", label: "Office" },
                      { id: "tenure", label: "Tenure" },
                      { id: "reset", label: "Leave year resets" },
                      ...(roster.annualType
                        ? [
                            { id: "annualTotal", label: "Allowance" },
                            { id: "annualUsed", label: "Used" },
                            { id: "annualLeft", label: "Left" },
                          ]
                        : []),
                    ].map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted-bg"
                      >
                        <input
                          type="checkbox"
                          checked={showCol(c.id)}
                          onChange={() => toggleBase(c.id)}
                          className="accent-accent"
                        />
                        <span className="text-foreground">{c.label}</span>
                      </label>
                    ))}
                    {otherTypes.length > 0 && (
                      <div className="my-1 border-t border-border" />
                    )}
                    {otherTypes.map((t) => (
                      <label
                        key={t.leaveTypeId}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted-bg"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(t.leaveTypeId)}
                          onChange={() => toggleColumn(t.leaveTypeId)}
                          className="accent-accent"
                        />
                        <span className="flex items-center gap-1.5 text-foreground">
                          <TypeDot color={t.color} />
                          {t.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
          )}
        </div>
        {roster === undefined ? (
          <Empty>Loading…</Empty>
        ) : roster.rows.length === 0 ? (
          <Empty>No active employees in this office yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-xs">
                  <SortableTh label="Name" sortKey="name" sort={rosterSort} onToggle={toggleRoster} className="!py-1.5 !pl-0 !pr-3" />
                  {showCol("office") && <SortableTh label="Office" sortKey="office" sort={rosterSort} onToggle={toggleRoster} className="!py-1.5 !pl-0 !pr-3" />}
                  {showCol("tenure") && <SortableTh label="Tenure" sortKey="tenure" sort={rosterSort} onToggle={toggleRoster} className="!py-1.5 !pl-0 !pr-3" />}
                  {showCol("reset") && <SortableTh label="Leave year resets" sortKey="reset" sort={rosterSort} onToggle={toggleRoster} className="!py-1.5 !pl-0 !pr-3" />}
                  {roster.annualType && (
                    <>
                      {showCol("annualTotal") && <SortableTh label="Allowance" sortKey="annualTotal" sort={rosterSort} onToggle={toggleRoster} align="right" className="!py-1.5 !pl-0 !pr-3" />}
                      {showCol("annualUsed") && <SortableTh label="Used" sortKey="annualUsed" sort={rosterSort} onToggle={toggleRoster} align="right" className="!py-1.5 !pl-0 !pr-3" />}
                      {showCol("annualLeft") && <SortableTh label="Left" sortKey="annualLeft" sort={rosterSort} onToggle={toggleRoster} align="right" className="!py-1.5 !pl-0 !pr-3" />}
                    </>
                  )}
                  {columnTypes.map((t) => (
                    <SortableTh
                      key={t.leaveTypeId}
                      label={t.name}
                      sortKey={`t_${t.leaveTypeId}`}
                      sort={rosterSort}
                      onToggle={toggleRoster}
                      align="right"
                      className="!py-1.5 !pl-0 !pr-3"
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRoster.map((r) => (
                  <tr key={r.userId} className="border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/employees/${r.userId}?from=dashboard`}
                        className="font-medium text-foreground hover:text-accent hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    {showCol("office") && (
                      <td className="py-2 pr-3 text-muted">{r.office ?? "—"}</td>
                    )}
                    {showCol("tenure") && (
                      <td className="py-2 pr-3 text-muted">
                        {r.startDate ? tenureLabel(r.startDate) || "—" : "—"}
                      </td>
                    )}
                    {showCol("reset") && (
                      <td className="py-2 pr-3 text-muted">
                        {formatDay(r.resetDate)}
                      </td>
                    )}
                    {roster.annualType && (
                      <>
                        {showCol("annualTotal") && (
                          <td className="py-2 pr-3 text-right text-foreground">
                            {r.annualTotal ?? "—"}
                          </td>
                        )}
                        {showCol("annualUsed") && (
                          <td className="py-2 pr-3 text-right text-muted">
                            {r.annualUsed ?? "—"}
                          </td>
                        )}
                        {showCol("annualLeft") && (
                          <td className="py-2 pr-3 text-right font-medium text-foreground">
                            {r.annualRemaining ?? "—"}
                          </td>
                        )}
                      </>
                    )}
                    {columnTypes.map((t) => (
                      <td
                        key={t.leaveTypeId}
                        className="py-2 pr-3 text-right text-muted"
                      >
                        {r.taken[t.leaveTypeId] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

    </AppShell>
  );
}
