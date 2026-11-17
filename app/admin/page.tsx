"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { useImpersonatedUserId, useEffectiveRole } from "@/lib/impersonation";
import {
  Card,
  SectionTitle,
  Empty,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

const selectCls =
  "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-foreground";

import { errorMessage } from "@/lib/errors";

export default function AdminPage() {
  const asUserId = useImpersonatedUserId();
  const role = useEffectiveRole();
  const canView = role === "superadmin";
  const people = useQuery(api.users.list, canView ? { asUserId: asUserId ?? undefined } : "skip");
  const types = useQuery(api.leaveTypes.list, {});

  const seed = useMutation(api.seed.run);
  const setRole = useMutation(api.users.setRole);

  const [addingAdmin, setAddingAdmin] = useState(false);

  const isSuper = role === "superadmin";
  // Demoting a superadmin is owner-only — see isOwner in convex/model.ts.
  const me = useQuery(api.users.me);
  const isOwner = me?.isOwner === true;

  // Approved members eligible to be promoted to admin.
  const promotableMembers = (people ?? []).filter(
    (p) =>
      p.role === "member" && p.status !== "pending" && p.status !== "rejected",
  );

  if (role !== undefined && !canView) {
    return (
      <AppShell>
        <Empty>Superadmins only.</Empty>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Admin"
      headerActions={
        // Only useful on a fresh, empty deployment — hide once seeded.
        types && types.length === 0 ? (
          <SecondaryButton onClick={() => void seed()}>
            Add starter leave types &amp; departments
          </SecondaryButton>
        ) : undefined
      }
    >

      {/* Admins — admins manage and approve; they don't take leave.
          Manage members (and impersonate them) from the Directory. The
          primary action sits above the card it acts on, right-aligned. */}
      {isSuper && (
        <div className="mb-3 flex justify-end">
          <PrimaryButton onClick={() => setAddingAdmin((a) => !a)}>
            {addingAdmin ? "Cancel" : "Add admin"}
          </PrimaryButton>
        </div>
      )}
      <Card className="mb-6">
        <SectionTitle>
          Admins
          <span
            title={`Members are managed (and impersonated) in the Directory. Only a superadmin can promote a member to admin (“Add admin”) or change an admin's role.`}
            className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border text-[10px] font-semibold normal-case text-muted"
          >
            i
          </span>
        </SectionTitle>
        {addingAdmin && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted-bg p-3">
            <span className="text-sm text-muted">Promote a member:</span>
            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                void setRole({
                  profileId: e.target.value as Id<"profiles">,
                  role: "admin",
                });
                setAddingAdmin(false);
              }}
              className={selectCls}
            >
              <option value="">Select a member…</option>
              {promotableMembers.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
            {promotableMembers.length === 0 && (
              <span className="text-sm text-muted">
                No members to promote yet.
              </span>
            )}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 font-semibold">Access</th>
              </tr>
            </thead>
            <tbody>
              {people
                ?.filter(
                  (p) => p.role === "admin" || p.role === "superadmin",
                )
                .map((p) => (
                  <tr key={p._id} className="border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-foreground">
                        {p.name}
                      </div>
                      <div className="text-xs text-muted">{p.email}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {/* A superadmin can only be demoted by an owner — the
                          top tier shouldn't be something peers can strip from
                          each other. Everyone else sees it as plain text. */}
                      {p.role === "superadmin" ? (
                        isOwner && p.userId !== me?.userId ? (
                          <select
                            value="superadmin"
                            onChange={(e) => {
                              const next = e.target.value;
                              if (next === "superadmin") return;
                              if (
                                !confirm(
                                  `Demote ${p.name} from superadmin to ${next}?`,
                                )
                              )
                                return;
                              void setRole({
                                profileId: p._id,
                                role: next as "admin" | "member",
                              }).catch((err) =>
                                alert(errorMessage(err, "Could not change role.")),
                              );
                            }}
                            className={selectCls}
                          >
                            <option value="superadmin">superadmin</option>
                            <option value="admin">↓ demote to admin</option>
                            <option value="member">↓ demote to member</option>
                          </select>
                        ) : (
                          <span className="capitalize text-muted">{p.role}</span>
                        )
                      ) : !isSuper ? (
                        <span className="capitalize text-muted">{p.role}</span>
                      ) : (
                        <select
                          value="admin"
                          onChange={(e) => {
                            if (e.target.value === "member") {
                              void setRole({ profileId: p._id, role: "member" });
                            } else if (e.target.value === "superadmin") {
                              void setRole({
                                profileId: p._id,
                                role: "superadmin",
                              });
                            }
                          }}
                          className={selectCls}
                        >
                          <option value="admin">admin</option>
                          <option value="superadmin">↑ make superadmin</option>
                          <option value="member">↓ demote to member</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

    </AppShell>
  );
}

