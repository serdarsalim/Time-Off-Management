"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { InlineEdit } from "@/components/InlineEdit";
import { ColorPicker } from "@/components/ColorPicker";
import {
  Card,
  SectionTitle,
  Empty,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";

const inputCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground";

const codeOf = (code?: string) => code ?? "IE";

// All of one country's leave types, with inline edit + a per-country add form.
export function CountryTypes({
  country,
  types,
}: {
  country: Doc<"countries">;
  types: Doc<"leaveTypes">[];
}) {
  const createType = useMutation(api.leaveTypes.create);
  const updateType = useMutation(api.leaveTypes.update);
  const archiveType = useMutation(api.leaveTypes.archive);
  const setAnnualConfig = useMutation(api.countries.setAnnualConfig);
  const reorderTypes = useMutation(api.leaveTypes.reorder);
  const [draft, setDraft] = useState({
    name: "",
    color: "#3b82f6",
    days: 0,
    deducts: true,
  });
  const [open, setOpen] = useState(false);
  // Which row the grip is currently holding, and the order being previewed
  // mid-drag. `pending` stays set until the server echoes the new order back,
  // so the list never flickers to the old positions on release.
  const [dragId, setDragId] = useState<Id<"leaveTypes"> | null>(null);
  const [pending, setPending] = useState<Id<"leaveTypes">[] | null>(null);

  const ordered = useMemo(() => {
    if (!pending) return types;
    const byId = new Map(types.map((t) => [t._id, t]));
    const seen = new Set(pending);
    return [
      ...pending.flatMap((id) => byId.get(id) ?? []),
      ...types.filter((t) => !seen.has(t._id)),
    ];
  }, [types, pending]);

  // Move the dragged row to sit where `overId` currently is.
  const previewMove = (overId: Id<"leaveTypes">) => {
    if (!dragId || dragId === overId) return;
    const ids = ordered.map((t) => t._id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setPending(ids);
  };

  const commitOrder = () => {
    setDragId(null);
    if (!pending) return;
    void reorderTypes({ orderedIds: pending }).then(() => setPending(null));
  };

  // The designation is a pointer on the country and nothing forces it to hold
  // a value: tapping the badge again clears it, and archiving the type it
  // points at leaves it dangling. Everything downstream then stops quietly
  // rather than failing, so the card has to say so out loud.
  const statutory = types.find((t) => t._id === country.annualLeaveTypeId);
  const canDesignate = types.some((t) => t.active && t.deductsAllowance);

  return (
    <div className="mt-3 rounded-md border border-dashed border-border p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        Leave types
        <InfoHint>
          “Paid time off” marks which type is this country&apos;s yearly leave
          allowance — the legal minimum everyone gets. Tap the badge on a type
          to set it; give individuals more in their profile. That type is the
          only one that carries days across the leave year: unused days roll in
          up to the “carry” limit, and days taken past the allowance roll in as
          a debt. Everything else starts each year at zero. Drag a row by its
          grip to reorder — that order is used everywhere: the booking form,
          balances, the calendar key and reports.
        </InfoHint>
      </div>

      {!statutory?.active && (
        <p className="mb-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
          {country.name} has no paid time off type set. Carryover doesn&apos;t
          run, a joining year isn&apos;t pro-rated, and the first-year rule
          never applies — all without erroring.{" "}
          {canDesignate
            ? "Tap “paid time off” on the type that is this country’s annual leave."
            : "Add a fixed-allowance type first — only those can be designated."}
        </p>
      )}

      <ul className="space-y-1">
        {ordered.map((t) => (
          <li
            key={t._id}
            draggable={dragId === t._id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              previewMove(t._id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              commitOrder();
            }}
            onDragEnd={commitOrder}
            className={`flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm ${
              dragId === t._id ? "opacity-50" : ""
            }`}
          >
            <span className="flex flex-1 items-center gap-2 text-foreground">
              <button
                type="button"
                aria-label={`Reorder ${t.name}`}
                title="Drag to reorder — this order is used everywhere"
                onMouseDown={() => setDragId(t._id)}
                onMouseUp={() => setDragId(null)}
                className="cursor-grab select-none px-0.5 text-muted transition-colors hover:text-foreground active:cursor-grabbing"
              >
                ⠿
              </button>
              <ColorPicker
                value={t.color}
                onChange={(c) =>
                  void updateType({ leaveTypeId: t._id, color: c })
                }
              />
              <InlineEdit
                value={t.name}
                className="flex-1"
                onSave={(v) => {
                  const n = v.trim();
                  if (n && n !== t.name)
                    void updateType({ leaveTypeId: t._id, name: n });
                }}
              />
              {t.deductsAllowance && (
                <button
                  type="button"
                  onClick={() =>
                    void setAnnualConfig({
                      countryId: country._id,
                      annualLeaveTypeId:
                        country.annualLeaveTypeId === t._id ? null : t._id,
                    })
                  }
                  title="This country's paid time off — the yearly leave allowance everyone gets. Give individuals more in their profile."
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    country.annualLeaveTypeId === t._id
                      ? "bg-accent-soft text-accent"
                      : "border border-border text-muted hover:bg-muted-bg"
                  }`}
                >
                  paid time off
                </button>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void updateType({
                    leaveTypeId: t._id,
                    showInLegend: t.showInLegend === false,
                  })
                }
                title={
                  t.showInLegend === false
                    ? "Hidden from the calendar key. The leave still shows on the calendar in this colour — click to add the swatch back."
                    : "Shown in the calendar key. Switch off when another country's type already explains this colour."
                }
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  t.showInLegend === false
                    ? "border border-border text-muted hover:bg-muted-bg"
                    : "bg-accent-soft text-accent hover:opacity-80"
                }`}
              >
                legend
              </button>
              {/* Nobody files a sick note for annual leave, so the country's
                  paid time off type doesn't offer the toggle at all. */}
              {country.annualLeaveTypeId !== t._id && (
                <button
                  type="button"
                  onClick={() =>
                    void updateType({ leaveTypeId: t._id, allowDoc: !t.allowDoc })
                  }
                  title={
                    t.allowDoc
                      ? "Employees can attach a document (e.g. sick cert) when requesting this type. Uploading stays optional."
                      : "No document upload on this type. Click to let employees attach one (e.g. sick cert)."
                  }
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    t.allowDoc
                      ? "bg-accent-soft text-accent hover:opacity-80"
                      : "border border-border text-muted hover:bg-muted-bg"
                  }`}
                >
                  docs
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void updateType({
                    leaveTypeId: t._id,
                    deductsAllowance: !t.deductsAllowance,
                  })
                }
                title={
                  t.deductsAllowance
                    ? "Fixed yearly allowance — deducts and shows the employee a balance."
                    : "Unlimited — no cap; the employee sees no balance, we just count days taken. Any number here is an internal soft cap (admin-only)."
                }
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  t.deductsAllowance
                    ? "bg-accent-soft text-accent hover:opacity-80"
                    : "border border-border text-muted hover:bg-muted-bg"
                }`}
              >
                {t.deductsAllowance ? "allowance" : "unlimited"}
              </button>
              {country.annualLeaveTypeId === t._id && (
                <InlineEdit
                  value={String(t.carryOverMaxDays ?? 0)}
                  type="number"
                  align="right"
                  className="w-24"
                  display={
                    t.carryOverMaxDays
                      ? `carry ${t.carryOverMaxDays}`
                      : "no carry"
                  }
                  onSave={(v) => {
                    const n = Math.max(0, Math.floor(Number(v) || 0));
                    if (n !== (t.carryOverMaxDays ?? 0))
                      void updateType({
                        leaveTypeId: t._id,
                        carryOverMaxDays: n,
                      });
                  }}
                />
              )}
              <InlineEdit
                value={String(t.defaultAllowanceDays)}
                type="number"
                align="right"
                className="w-24"
                display={
                  t.deductsAllowance
                    ? `${t.defaultAllowanceDays} days/yr`
                    : t.defaultAllowanceDays > 0
                      ? `cap ${t.defaultAllowanceDays}`
                      : "no cap"
                }
                onSave={(v) => {
                  const n = Math.max(0, Math.floor(Number(v) || 0));
                  if (n !== t.defaultAllowanceDays)
                    void updateType({
                      leaveTypeId: t._id,
                      defaultAllowanceDays: n,
                    });
                }}
              />
            </div>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Remove “${t.name}”? Existing requests keep it; it just won't be selectable for new ones.`,
                  )
                )
                  void archiveType({ leaveTypeId: t._id });
              }}
              aria-label="Remove leave type"
              className="shrink-0 text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
            >
              ✕
            </button>
          </li>
        ))}
        {types.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-muted">No leave types yet.</li>
        )}
      </ul>

      <div className="mt-2">
        <SecondaryButton onClick={() => setOpen(true)}>
          + Add leave type
        </SecondaryButton>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Add leave type — ${country.name}`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            void createType({
              name: draft.name.trim(),
              color: draft.color,
              countryCode: country.code,
              defaultAllowanceDays: draft.days,
              deductsAllowance: draft.deducts,
            });
            setDraft({ name: "", color: "#3b82f6", days: 0, deducts: true });
            setOpen(false);
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Name
            </label>
            <div className="flex items-center gap-2">
              <ColorPicker
                value={draft.color}
                onChange={(c) => setDraft({ ...draft, color: c })}
              />
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Sick leave"
                className={`flex-1 ${inputCls}`}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Mode
            </label>
            <div className="flex gap-2">
              {[
                { deducts: true, label: "Fixed allowance" },
                { deducts: false, label: "Unlimited" },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => setDraft({ ...draft, deducts: m.deducts })}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    draft.deducts === m.deducts
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-muted hover:bg-muted-bg"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              {draft.deducts
                ? "Deducts from a yearly balance and shows the employee how many days are left."
                : "No cap. The employee sees no balance — we just count the days they take."}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {draft.deducts ? "Days per year" : "Internal soft cap (optional)"}
            </label>
            <input
              type="number"
              min={0}
              value={draft.days}
              onChange={(e) =>
                setDraft({ ...draft, days: Number(e.target.value) })
              }
              className={`w-28 ${inputCls}`}
            />
            <p className="mt-1 text-xs text-muted">
              {draft.deducts
                ? "The default entitlement; override per person in their profile."
                : "Admin-only reference (e.g. 50). Never shown to the employee. Leave 0 for none."}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setOpen(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={!draft.name.trim()}>
              Add
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function LeaveTypesCard() {
  const countries = useQuery(api.countries.list);
  const types = useQuery(api.leaveTypes.list, {});

  return (
    <Card>
      <SectionTitle>
        Leave types
        <InfoHint>
          Each country has its own leave types and days/yr. Tap “paid time off”
          on one type to mark it as the country’s minimum annual entitlement —
          give individuals more in their profile.
        </InfoHint>
      </SectionTitle>
      <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
        {countries === undefined ? (
          <Empty>Loading…</Empty>
        ) : countries.length === 0 ? (
          <Empty>Add a country first.</Empty>
        ) : (
          countries.map((c) => (
            <CountryTypes
              key={c._id}
              country={c}
              types={(types ?? []).filter(
                (t) => codeOf(t.countryCode) === c.code,
              )}
            />
          ))
        )}
      </div>
    </Card>
  );
}
