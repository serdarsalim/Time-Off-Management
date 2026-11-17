"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import { InlineEdit, InlineSelect } from "@/components/InlineEdit";
import { Combobox } from "@/components/Combobox";
import { Modal } from "@/components/Modal";
import {
  Card,
  SectionTitle,
  Empty,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
import { formatRange } from "@/lib/dates";
import { useImpersonatedUserId, useEffectiveRole } from "@/lib/impersonation";

const inputCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground";

type OffNow = { userId: string; name: string; endDate: string };
type Upcoming = {
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
};

// Presence: "in office X / total", and only when someone is actually off do
// we name them. No "everyone in" noise.
function Presence({
  offNow,
  headcount,
}: {
  offNow: OffNow[];
  headcount: number;
}) {
  const inCount = Math.max(headcount - offNow.length, 0);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-foreground">
        {inCount}/{headcount}
      </span>
      {offNow.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          {offNow.map((p) => (
            <span
              key={p.userId}
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
              title={`Back ${p.endDate}`}
            >
              {p.name}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export default function DepartmentsPage() {
  const asUserId = useImpersonatedUserId();
  const role = useEffectiveRole();
  const isAdmin = role === "superadmin";
  const data = useQuery(api.departments.overview);
  const people = useQuery(api.users.list, isAdmin ? { asUserId: asUserId ?? undefined } : "skip");

  const createDept = useMutation(api.departments.create);
  const renameDept = useMutation(api.departments.rename);
  const removeDept = useMutation(api.departments.remove);
  const setApprover = useMutation(api.departments.setApprover);
  const setRole = useMutation(api.users.setRole);

  const teams = useQuery(api.teams.list, isAdmin ? {} : "skip");
  const createTeam = useMutation(api.teams.create);
  const renameTeam = useMutation(api.teams.rename);
  const removeTeam = useMutation(api.teams.remove);

  const [newDept, setNewDept] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newTeam, setNewTeam] = useState("");

  function submitNewDept() {
    const name = newDept.trim();
    if (!name) return;
    void createDept({ name });
    setNewDept("");
    setAddOpen(false);
  }

  // Candidates to approve a department: office managers and admins.
  const approverChoices = (people ?? []).filter(
    (p) =>
      p.role === "office_manager" ||
      p.role === "admin" ||
      p.role === "superadmin",
  );
  const officeManagers = (people ?? []).filter(
    (p) => p.role === "office_manager",
  );
  const promotable = (people ?? []).filter(
    (p) =>
      p.role === "member" && p.status !== "pending" && p.status !== "rejected",
  );

  if (role !== undefined && !isAdmin) {
    return (
      <AppShell>
        <Empty>Admins only.</Empty>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Offices"
      titleInfo={
        <InfoHint>Headcount, who’s off, and each office’s approver.</InfoHint>
      }
    >

      {/* The primary action sits above the card it acts on, right-aligned. */}
      <div className="mb-3 flex justify-end">
        <PrimaryButton onClick={() => setAddOpen(true)}>
          Add office
        </PrimaryButton>
      </div>

      {data === undefined ? (
        <Empty>Loading…</Empty>
      ) : data.departments.length === 0 ? (
        <Empty>No offices yet — add one below.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="px-4 pt-3.5 pb-2.5 font-semibold">Office</th>
                <th className="px-4 pt-3.5 pb-2.5 font-semibold">Headcount</th>
                <th className="px-4 pt-3.5 pb-2.5 font-semibold">In office</th>
                <th className="px-4 pt-3.5 pb-2.5 font-semibold">Off now</th>
                <th className="px-4 pt-3.5 pb-2.5 font-semibold">Approver</th>
                <th className="px-4 pt-3.5 pb-2.5 font-semibold">Upcoming (14d)</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map((d) => (
                <tr key={d._id} className="border-t border-[var(--table-divider)] align-middle hover:bg-[var(--row-hover-bg)]">
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    <InlineEdit
                      value={d.name}
                      onSave={(v) => {
                        const n = v.trim();
                        if (n && n !== d.name)
                          void renameDept({ departmentId: d._id, name: n });
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{d.headcount}</td>
                  <td className="px-4 py-2.5 text-foreground">
                    {Math.max(d.headcount - d.offNow.length, 0)}/{d.headcount}
                  </td>
                  <td className="px-4 py-2.5">
                    {d.offNow.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1">
                        {d.offNow.map((p: OffNow) => (
                          <span
                            key={p.userId}
                            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                            title={`Back ${p.endDate}`}
                          >
                            {p.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <InlineSelect
                      value={d.approverId ?? ""}
                      onChange={(v) => {
                        // The placeholder isn't a real choice — clearing an
                        // approver isn't supported, so ignore it.
                        if (v)
                          void setApprover({
                            departmentId: d._id,
                            approverId: v as Id<"users">,
                          });
                      }}
                      options={[
                        { value: "", label: "Set approver…" },
                        ...approverChoices.map((p) => ({
                          value: p.userId,
                          label: p.name,
                        })),
                      ]}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {d.upcoming.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span
                        className="cursor-help text-foreground underline decoration-dotted underline-offset-2"
                        title={d.upcoming
                          .map(
                            (u: Upcoming) =>
                              `${u.name}: ${formatRange(u.startDate, u.endDate)}`,
                          )
                          .join("\n")}
                      >
                        {d.upcoming.length} planned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Remove the “${d.name}” office?`))
                          void removeDept({ departmentId: d._id });
                      }}
                      aria-label={`Remove ${d.name}`}
                      className="text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {data.unassigned.headcount > 0 && (
                <tr className="border-t border-[var(--table-divider)] align-middle">
                  <td className="px-4 py-2.5 text-muted">
                    No office
                    <span
                      className="ml-1.5 cursor-help text-xs"
                      title="Assign people to an office from the Employees directory."
                    >
                      ⓘ
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {data.unassigned.headcount}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {Math.max(
                      data.unassigned.headcount - data.unassigned.offNow.length,
                      0,
                    )}
                    /{data.unassigned.headcount}
                  </td>
                  <td className="px-4 py-2.5" colSpan={4}>
                    {data.unassigned.offNow.length > 0 && (
                      <Presence
                        offNow={data.unassigned.offNow}
                        headcount={data.unassigned.headcount}
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add department — input happens in a modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add office"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitNewDept();
          }}
        >
          <input
            autoFocus
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            placeholder="Office name"
            className={`w-full ${inputCls}`}
          />
          <div className="mt-4 flex justify-end gap-2">
            <SecondaryButton type="button" onClick={() => setAddOpen(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={!newDept.trim()}>
              Add office
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* Departments and office managers sit side by side — both are short
          lists, and on desktop they fit in one row. */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
      {/* Departments (functional teams) — the pick-list behind the directory's
          Department column. Labels only; approver routing stays on offices. */}
      <Card className="flex flex-col">
        <SectionTitle>Departments</SectionTitle>
        <p className="mb-3 mt-1 text-xs text-muted">
          The choices offered in the directory’s Department column. Assign
          people from the Employees page.
        </p>
        <div className="flex-1">
          {teams === undefined ? (
            <Empty>Loading…</Empty>
          ) : teams.length === 0 ? (
            <Empty>No departments yet — add one below.</Empty>
          ) : (
            <ul className="space-y-1">
              {teams.map((t) => (
                <li
                  key={t._id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  <InlineEdit
                    value={t.name}
                    className="text-foreground"
                    onSave={(v) => {
                      const n = v.trim();
                      if (n && n !== t.name)
                        void renameTeam({ teamId: t._id, name: n });
                    }}
                  />
                  <button
                    onClick={() => {
                      if (confirm(`Remove the “${t.name}” department?`))
                        removeTeam({ teamId: t._id }).catch((err) =>
                          alert(
                            err instanceof Error
                              ? err.message
                              : "Could not remove department.",
                          ),
                        );
                    }}
                    aria-label={`Remove ${t.name}`}
                    className="text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newTeam.trim();
            if (!name) return;
            createTeam({ name })
              .then(() => setNewTeam(""))
              .catch((err) =>
                alert(
                  err instanceof Error
                    ? err.message
                    : "Could not add department.",
                ),
              );
          }}
        >
          <input
            value={newTeam}
            onChange={(e) => setNewTeam(e.target.value)}
            placeholder="New department name"
            className={`flex-1 ${inputCls}`}
          />
          <PrimaryButton type="submit" disabled={!newTeam.trim()}>
            Add
          </PrimaryButton>
        </form>
      </Card>

      {/* Office managers — they approve their office's leave. */}
      <Card className="flex flex-col">
        <SectionTitle>Office managers</SectionTitle>
        <p className="mb-3 mt-1 text-xs text-muted">
          Office managers book their own leave and approve their team. Assign one
          as an office’s approver above.
        </p>
        <div className="flex-1">
          {officeManagers.length === 0 ? (
            <Empty>No office managers yet.</Empty>
          ) : (
            <ul className="space-y-1">
              {officeManagers.map((p) => (
                <li
                  key={p._id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  <span className="text-foreground">{p.name}</span>
                  <button
                    onClick={() => {
                      if (confirm(`Remove office-manager role from ${p.name}?`))
                        void setRole({ profileId: p._id, role: "member" });
                    }}
                    className="text-xs font-medium text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {promotable.length > 0 && (
          <div className="mt-3">
            <Combobox
              value=""
              onChange={(v) => {
                if (v)
                  void setRole({
                    profileId: v as Id<"profiles">,
                    role: "office_manager",
                  });
              }}
              options={promotable.map((p) => ({
                value: p._id,
                label: p.name,
                hint: p.departmentName ?? undefined,
              }))}
              placeholder="Promote a member to office manager…"
            />
          </div>
        )}
      </Card>
      </div>
    </AppShell>
  );
}
