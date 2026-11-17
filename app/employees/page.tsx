"use client";

import { useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/errors";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  startImpersonation,
  useImpersonatedUserId,
  useEffectiveRole,
} from "@/lib/impersonation";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import { DatePicker } from "@/components/DatePicker";
import { InlineEdit, InlineSelect } from "@/components/InlineEdit";
import {
  FilterableTh,
  SortableTh,
  useSortedRows,
} from "@/components/SortableTable";
import { Card, Empty } from "@/components/ui";

// Small tag marking an office manager in the directory.
function OmBadge() {
  return (
    <span
      title="Office Manager — books their own leave and approves their team."
      className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
    >
      Office Mgr
    </span>
  );
}

// Admins are staff too — they just also manage the app.
function AdminBadge() {
  return (
    <span
      title="Admin — manages people and settings, and approves leave."
      className="rounded bg-muted-bg px-1.5 py-0.5 text-[10px] font-medium text-muted"
    >
      Admin
    </span>
  );
}

// Marks someone kept out of the shared views. Only visible here, which is the
// point — this list is the one place a hidden person still shows up.
function HiddenBadge() {
  return (
    <span
      title="Hidden from the team calendar, who's off today, headcount, office presence and department rosters. Their leave and balance work as normal."
      className="rounded bg-muted-bg px-1.5 py-0.5 text-[10px] font-medium text-muted"
    >
      Hidden
    </span>
  );
}

// The badge for a person's permission tier, if any.
function RoleBadge({ role }: { role: string }) {
  if (role === "office_manager") return <OmBadge />;
  if (role === "admin" || role === "superadmin") return <AdminBadge />;
  return null;
}

export default function EmployeesPage() {
  const asUserId = useImpersonatedUserId();
  // The directory is a management surface — admins, superadmins, and office
  // managers only. Regular members can't view it.
  const role = useEffectiveRole();
  // The directory lists the whole company, so it follows the same rule as the
  // other company-wide surfaces: superadmins only.
  const canView = role === "superadmin";
  const people = useQuery(api.users.list, canView ? { asUserId: asUserId ?? undefined } : "skip");
  const departments = useQuery(api.departments.list);
  const teams = useQuery(api.teams.list);
  const countries = useQuery(api.countries.list);
  // Display label for a country code, falling back to the raw code.
  const countryLabel = (code?: string) =>
    countries?.find((c) => c.code === (code ?? "IE"))?.name ?? code ?? "—";

  const setTitle = useMutation(api.users.setTitle);
  const setTeam = useMutation(api.users.setTeam);
  const assign = useMutation(api.users.assign);
  const setCountry = useMutation(api.users.setCountry);
  const approveMember = useMutation(api.users.approveMember);
  const rejectMember = useMutation(api.users.rejectMember);
  const logImpersonationStart = useMutation(api.users.logImpersonationStart);
  const router = useRouter();

  const [q, setQ] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  // Department and approver are stored differently — team by NAME, approver by
  // managerId — so "none" is the sentinel for "unset" in both.
  const [teamFilter, setTeamFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [approverFilter, setApproverFilter] = useState("");
  // Default to active staff — inactive people stay one click away.
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive">(
    "active",
  );

  const isAdmin = role === "admin" || role === "superadmin";

  // Column funnels are easy to leave on by accident, so surface how many are
  // active and offer one click to clear them. Status is excluded — it always
  // has a value, so it would read as permanently "on".
  const activeFilters = [deptFilter, teamFilter, countryFilter, approverFilter]
    .filter(Boolean).length;
  function resetFilters() {
    setDeptFilter("");
    setTeamFilter("");
    setCountryFilter("");
    setApproverFilter("");
  }

  // The directory lists the whole company — admins included. They manage the
  // app on top of being staff, so they're marked with a badge rather than
  // filtered out.
  const staffRows = people ?? [];
  // Awaiting approval (admins act on these). Only members can be pending —
  // office managers and admins are activated when the role is assigned.
  const pending = staffRows.filter((p) => p.status === "pending");
  // Rejected sign-ups that still hold an email. Usually somebody who signed up
  // as their own duplicate — the address is stuck on the wrong record until
  // it's matched across, so they need somewhere to live until then.
  const rejectedSignups = staffRows.filter(
    (p) => p.status === "rejected" && p.email,
  );
  // Who a sign-up can be matched into: approved people, alphabetical.
  const matchCandidates = staffRows
    .filter((p) => p.status !== "pending" && p.status !== "rejected")
    .map((p) => ({ userId: p.userId, name: p.name, email: p.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Approved staff (legacy rows with no status count as active).
  const filtered = staffRows
    .filter((p) => p.status !== "pending" && p.status !== "rejected")
    .filter((p) =>
      q.trim()
        ? `${p.name} ${p.email} ${p.title ?? ""} ${p.departmentName ?? ""} ${p.team ?? ""}`
            .toLowerCase()
            .includes(q.trim().toLowerCase())
        : true,
    )
    .filter((p) => (deptFilter ? p.departmentId === deptFilter : true))
    .filter((p) =>
      teamFilter
        ? teamFilter === "none"
          ? !p.team
          : p.team === teamFilter
        : true,
    )
    .filter((p) => (countryFilter ? (p.country ?? "IE") === countryFilter : true))
    .filter((p) =>
      approverFilter
        ? approverFilter === "none"
          ? !p.managerId
          : p.managerId === approverFilter
        : true,
    )
    .filter((p) => (statusFilter === "active" ? p.active : !p.active));

  const {
    sorted: members,
    sort,
    toggle,
    sortBy,
  } = useSortedRows(
    filtered,
    {
      name: (p) => p.name,
      title: (p) => p.title,
      department: (p) => p.departmentName,
      team: (p) => p.team,
      country: (p) => countryLabel(p.country),
      email: (p) => p.email,
    },
    { key: "name", dir: "asc" },
  );

  // Possible approvers = anyone who isn't a member (admins/superadmins).
  const approvers = (people ?? []).filter((p) => p.role !== "member");

  async function actAs(userId: Id<"users">) {
    try {
      await logImpersonationStart({ targetUserId: userId });
      startImpersonation(userId);
      router.push("/");
    } catch (err) {
      alert(errorMessage(err, "Could not act as this user."));
    }
  }

  if (role !== undefined && !canView) {
    return (
      <AppShell>
        <Empty>Superadmins only.</Empty>
      </AppShell>
    );
  }

  return (
    <AppShell
      search={{
        value: q,
        onChange: setQ,
        }}
      title="Employee Directory"
      titleInfo={
        <InfoHint>{people ? `${members.length} people` : "Loading…"}</InfoHint>
      }
    >
      <div className="mb-6 flex flex-wrap items-end justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status is a scope, not a column filter — the Active column is
              gone, so it stays visible rather than hiding behind a funnel. */}
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {(
              [
                ["active", "Active"],
                ["inactive", "Inactive"],
              ] as const
            ).map(([v, text]) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatusFilter(v)}
                className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                  statusFilter === v
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {text}
              </button>
            ))}
          </div>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
            >
              Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>

      {isAdmin && pending.length > 0 && (
        <Card className="mb-6 border-amber-500/30">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            Pending approval
            <span className="group relative inline-flex">
              <span className="cursor-help rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                {pending.length}
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-60 -translate-x-1/2 rounded-md border border-border bg-card p-2.5 text-xs font-normal normal-case leading-relaxed text-muted opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
              >
                Review each person before approving — start date and country
                drive their leave entitlement, and you can adjust the days
                before confirming.
              </span>
            </span>
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <PendingApprovalRow
                key={p._id}
                person={p}
                onApprove={(startDate, country, overrides, extra) =>
                  approveMember({
                    profileId: p._id,
                    startDate,
                    country,
                    overrides,
                    title: extra.title,
                    departmentId: extra.departmentId,
                  })
                }
                onReject={() => rejectMember({ profileId: p._id })}
                extraAction={
                  <MatchSignup
                    signupProfileId={p._id}
                    signupName={p.name}
                    candidates={matchCandidates}
                  />
                }
              />
            ))}
          </div>
        </Card>
      )}

      {isAdmin && rejectedSignups.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            Rejected sign-ups
          </h2>
          <p className="mb-3 text-xs text-muted">
            These accounts can&apos;t use the app, but they still hold an email
            address. If one of them is someone already in the directory, match
            them across — that person gets the address and keeps their history.
          </p>
          <div className="space-y-2">
            {rejectedSignups.map((p) => (
              <div
                key={p._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {p.name}
                  </div>
                  <div className="text-xs text-muted">
                    {p.email}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </div>
                </div>
                <MatchSignup
                  signupProfileId={p._id}
                  signupName={p.name}
                  candidates={matchCandidates}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {people === undefined ? (
        <Empty>Loading…</Empty>
      ) : members.length === 0 ? (
        <Empty>No approved staff yet. People appear here once approved.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              {/* group/head lets each funnel fade in on header hover */}
              <tr className="group/head text-left text-xs">
                <SortableTh label="Name" sortKey="name" sort={sort} onToggle={toggle} />
                <SortableTh label="Title" sortKey="title" sort={sort} onToggle={toggle} />
                <FilterableTh
                  label="Office"
                  sortKey="department"
                  sort={sort}
                  onToggle={toggle}
                  onSort={sortBy}
                  filter={{
                    value: deptFilter,
                    onChange: setDeptFilter,
                    options: [
                      { value: "", label: "All offices" },
                      ...(departments ?? []).map((d) => ({
                        value: d._id,
                        label: d.name,
                      })),
                    ],
                  }}
                />
                <FilterableTh
                  label="Department"
                  sortKey="team"
                  sort={sort}
                  onToggle={toggle}
                  onSort={sortBy}
                  filter={{
                    value: teamFilter,
                    onChange: setTeamFilter,
                    options: [
                      { value: "", label: "All departments" },
                      ...(teams ?? []).map((t) => ({
                        value: t.name,
                        label: t.name,
                      })),
                      { value: "none", label: "No department" },
                    ],
                  }}
                />
                <FilterableTh
                  label="Country"
                  sortKey="country"
                  sort={sort}
                  onToggle={toggle}
                  onSort={sortBy}
                  filter={{
                    value: countryFilter,
                    onChange: setCountryFilter,
                    options: [
                      { value: "", label: "All countries" },
                      ...(countries ?? []).map((c) => ({
                        value: c.code,
                        label: c.name,
                      })),
                    ],
                  }}
                />
                {isAdmin ? (
                  <>
                    <FilterableTh
                      label="Approver"
                      filter={{
                        value: approverFilter,
                        onChange: setApproverFilter,
                        options: [
                          { value: "", label: "All approvers" },
                          ...approvers.map((m) => ({
                            value: m.userId,
                            label: m.name,
                          })),
                          { value: "none", label: "Office default" },
                        ],
                      }}
                    />
                    <th className="px-4 pt-3.5 pb-2.5 font-semibold"></th>
                  </>
                ) : (
                  <SortableTh label="Email" sortKey="email" sort={sort} onToggle={toggle} />
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((p) => (
                <tr key={p._id} className="border-t border-[var(--table-divider)] align-middle hover:bg-[var(--row-hover-bg)]">
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <Link
                        href={`/employees/${p.userId}?from=directory`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <span className="font-medium text-foreground">
                          {p.name}
                        </span>
                        <RoleBadge role={p.role} />
                        {p.hiddenFromRoster && <HiddenBadge />}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {p.name}
                        </span>
                        <RoleBadge role={p.role} />
                        {p.hiddenFromRoster && <HiddenBadge />}
                      </div>
                    )}
                  </td>

                  {/* Title */}
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <InlineEdit
                        value={p.title ?? ""}
                        display={p.title || "—"}
                        placeholder="e.g. Recruiter"
                        onSave={(v) => {
                          if ((v.trim() || "") !== (p.title ?? ""))
                            void setTitle({ profileId: p._id, title: v });
                        }}
                      />
                    ) : (
                      <span className="text-muted">{p.title || "—"}</span>
                    )}
                  </td>

                  {/* Office (internally "department") */}
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <InlineSelect
                        value={p.departmentId ?? ""}
                        onChange={(v) =>
                          void assign({
                            profileId: p._id,
                            departmentId: v
                              ? (v as Id<"departments">)
                              : undefined,
                            managerId: p.managerId,
                          })
                        }
                        options={[
                          { value: "", label: "—" },
                          ...(departments ?? []).map((d) => ({
                            value: d._id,
                            label: d.name,
                          })),
                        ]}
                      />
                    ) : (
                      <span className="text-muted">
                        {p.departmentName ?? "—"}
                      </span>
                    )}
                  </td>

                  {/* Department (functional team). Options come from the
                      teams pick-list; a legacy free-text value not on the
                      list is kept selectable so it doesn't display blank. */}
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <InlineSelect
                        value={p.team ?? ""}
                        onChange={(v) =>
                          void setTeam({ profileId: p._id, team: v })
                        }
                        options={[
                          { value: "", label: "—" },
                          ...(p.team &&
                          !(teams ?? []).some((t) => t.name === p.team)
                            ? [{ value: p.team, label: p.team }]
                            : []),
                          ...(teams ?? []).map((t) => ({
                            value: t.name,
                            label: t.name,
                          })),
                        ]}
                      />
                    ) : (
                      <span className="text-muted">{p.team || "—"}</span>
                    )}
                  </td>

                  {/* Country */}
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <InlineSelect
                        value={p.country ?? "IE"}
                        onChange={(v) =>
                          void setCountry({ profileId: p._id, country: v })
                        }
                        options={(countries ?? []).map((c) => ({
                          value: c.code,
                          label: c.name,
                        }))}
                      />
                    ) : (
                      <span className="text-muted">
                        {countryLabel(p.country)}
                      </span>
                    )}
                  </td>

                  {isAdmin ? (
                    <>
                      {/* Approver */}
                      <td className="px-4 py-2.5">
                        <InlineSelect
                          value={p.managerId ?? ""}
                          onChange={(v) =>
                            void assign({
                              profileId: p._id,
                              departmentId: p.departmentId,
                              managerId: v ? (v as Id<"users">) : undefined,
                            })
                          }
                          options={[
                            { value: "", label: "office default" },
                            ...approvers.map((m) => ({
                              value: m.userId,
                              label: m.name,
                            })),
                          ]}
                        />
                      </td>
                      {/* Actions — you can't act as an admin, so that row
                          shows no button. */}
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end">
                          {p.canImpersonate && (
                            <button
                              onClick={() => void actAs(p.userId)}
                              aria-label={`Act as ${p.name}`}
                              title={`Act as ${p.name}`}
                              className="rounded-md p-1.5 text-muted transition-colors hover:bg-muted-bg hover:text-foreground"
                            >
                              <svg
                                width="16" height="16" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                              >
                                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  ) : (
                    <td className="px-4 py-2.5 text-muted">{p.email}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AppShell>
  );
}

type Override = { leaveTypeId: Id<"leaveTypes">; days: number };
type ApproveExtra = { title?: string; departmentId?: Id<"departments"> };

// Attach a sign-up to somebody the directory already knows about, for when a
// person signs themselves up and turns into their own duplicate. Picking a
// name here hands that person the sign-up's email — their leave history stays
// where it is, which is the whole point of matching rather than approving.
function MatchSignup({
  signupProfileId,
  signupName,
  candidates,
}: {
  signupProfileId: Id<"profiles">;
  signupName: string;
  candidates: { userId: Id<"users">; name: string; email: string }[];
}) {
  const matchMember = useMutation(api.users.matchMember);
  const [targetUserId, setTargetUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const target = candidates.find((c) => c.userId === targetUserId);

  async function go() {
    if (!target) return;
    if (
      !confirm(
        `Give ${target.name} the sign-up's email address and drop the duplicate account for ${signupName}?\n\n${target.name} keeps their leave history and signs in with it from now on.`,
      )
    )
      return;
    setBusy(true);
    try {
      await matchMember({
        signupProfileId,
        targetUserId: targetUserId as Id<"users">,
      });
      setTargetUserId("");
    } catch (err) {
      alert(errorMessage(err, "Could not match this sign-up."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={targetUserId}
        onChange={(e) => setTargetUserId(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground"
      >
        <option value="">Match to someone…</option>
        {candidates.map((c) => (
          <option key={c.userId} value={c.userId}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => void go()}
        disabled={busy || !target}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg disabled:opacity-50"
      >
        Match
      </button>
    </div>
  );
}

// A pending sign-up awaiting approval. Clicking "Review & approve" opens a
// modal to set start date / country and review (and adjust) the leave days.
function PendingApprovalRow({
  person,
  onApprove,
  onReject,
  extraAction,
}: {
  person: {
    name: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
  };
  onApprove: (
    startDate: string,
    country: string,
    overrides: Override[],
    extra: ApproveExtra,
  ) => Promise<unknown>;
  onReject: () => Promise<unknown>;
  extraAction?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const displayName =
    person.firstName || person.lastName
      ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim()
      : person.name;

  async function reject() {
    setBusy(true);
    try {
      await onReject();
    } catch (err) {
      alert(errorMessage(err, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{displayName}</div>
        <div className="text-xs text-muted">
          {person.email}
          {person.phone ? ` · ${person.phone}` : ""}
          {!person.firstName && " · profile not completed yet"}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extraAction}
        <button
          onClick={() => void reject()}
          disabled={busy}
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          Reject
        </button>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Review &amp; approve…
        </button>
      </div>
      {open && (
        <ApproveModal
          name={displayName}
          email={person.email}
          onApprove={onApprove}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// Approval modal: set start date + country, see the computed leave entitlement,
// adjust any day counts, then confirm.
function ApproveModal({
  name,
  email,
  onApprove,
  onClose,
}: {
  name: string;
  email: string;
  onApprove: (
    startDate: string,
    country: string,
    overrides: Override[],
    extra: ApproveExtra,
  ) => Promise<unknown>;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [country, setCountry] = useState("IE");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  // Edited day values keyed by leaveTypeId. Reset whenever start/country change
  // so the figures re-baseline to that country's computed defaults.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const departments = useQuery(api.departments.list);
  const countries = useQuery(api.countries.list);

  // Matches the DatePicker button height so the fields align on each row.
  const fieldCls =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground";

  const preview = useQuery(
    api.allowances.previewForApproval,
    startDate ? { startDate, country } : "skip",
  );

  function changeStart(v: string) {
    setStartDate(v);
    setEdited({});
  }
  function changeCountry(v: string) {
    setCountry(v);
    setEdited({});
  }

  const deducting = (preview?.types ?? []).filter((t) => t.deductsAllowance);

  async function confirm() {
    if (!startDate) return;
    const overrides: Override[] = [];
    for (const t of deducting) {
      const shown = edited[t.leaveTypeId];
      if (shown === undefined) continue; // untouched → keep auto amount
      const n = Number(shown);
      if (Number.isFinite(n) && n !== t.days) {
        overrides.push({ leaveTypeId: t.leaveTypeId, days: n });
      }
    }
    setBusy(true);
    try {
      await onApprove(startDate, country, overrides, {
        title: title.trim() || undefined,
        departmentId: (departmentId || undefined) as
          | Id<"departments">
          | undefined,
      });
      onClose();
    } catch (err) {
      alert(errorMessage(err, "Could not approve."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">Approve {name}</h2>
        <p className="mb-4 text-xs text-muted">{email}</p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Start date
              </span>
              <DatePicker
                value={startDate}
                onChange={changeStart}
                placeholder="Pick a date"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Country
              </span>
              <select
                value={country}
                onChange={(e) => changeCountry(e.target.value)}
                className={fieldCls}
              >
                {(countries ?? []).map((c) => (
                  <option key={c._id} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Office
              </span>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className={fieldCls}
              >
                <option value="">— None —</option>
                {departments?.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Position
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Recruiter"
                className={fieldCls}
              />
            </label>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              Leave entitlement
            </span>
            {preview && (
              <span className="text-xs text-muted">
                Leave year: {preview.label}
              </span>
            )}
          </div>

          {!startDate ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
              Pick a start date to see their entitlement.
            </p>
          ) : preview === undefined ? (
            <p className="text-sm text-muted">Calculating…</p>
          ) : deducting.length === 0 ? (
            <p className="text-sm text-muted">
              No allowance-based leave types configured.
            </p>
          ) : (
            <div className="space-y-1.5">
              {deducting.map((t) => {
                const shown = edited[t.leaveTypeId] ?? String(t.days);
                const changed =
                  edited[t.leaveTypeId] !== undefined &&
                  Number(shown) !== t.days;
                return (
                  <div
                    key={t.leaveTypeId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm text-foreground">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: t.color }}
                      />
                      {t.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={shown}
                        onChange={(e) =>
                          setEdited((m) => ({
                            ...m,
                            [t.leaveTypeId]: e.target.value,
                          }))
                        }
                        className="w-20 rounded border border-border bg-background px-2 py-1 text-right text-sm text-foreground outline-none focus:border-foreground"
                      />
                      <span className="w-12 text-[10px] text-muted">
                        {changed ? "manual" : "days"}
                      </span>
                    </span>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted">
                Auto-calculated from country &amp; start date. Change a number to
                set it manually.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-muted-bg hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void confirm()}
            disabled={busy || !startDate}
            title={!startDate ? "Set a start date first" : "Approve"}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Approving…" : "Confirm & approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
