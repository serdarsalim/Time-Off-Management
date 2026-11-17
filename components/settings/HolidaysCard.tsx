"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Card,
  SectionTitle,
  Empty,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";
import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";
import { DatePicker } from "@/components/DatePicker";

const inputCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground";
const selectCls =
  "rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground";

const codeOf = (code?: string) => code ?? "IE";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-03-17" -> "17 March". Year is shown in the section heading, so we drop
// it here. Parse the parts directly to dodge timezone shifts from new Date().
const fmtDate = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : iso;
};

// One country's holidays for the year. The built-in seeders only exist for
// IE/TR; other countries are managed by hand.
function HolidayColumn({
  name,
  year,
  list,
  onLoad,
  onRemove,
}: {
  name: string;
  year: number;
  list: { _id: Id<"holidays">; name: string; date: string }[];
  onLoad?: () => void;
  onRemove: (id: Id<"holidays">) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {name} · {year}
        </h3>
        {list.length === 0 && onLoad && (
          <SecondaryButton onClick={onLoad}>Load {year}</SecondaryButton>
        )}
      </div>
      {list.length === 0 ? (
        <Empty>None loaded for {year}.</Empty>
      ) : (
        <div className="space-y-1">
          {list.map((h) => (
            <div
              key={h._id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <span>
                <span className="font-medium text-foreground">{h.name}</span>
                <span className="ml-2 text-xs text-muted">{h.date}</span>
              </span>
              <button
                onClick={() => onRemove(h._id)}
                aria-label={`Remove ${h.name}`}
                title="Remove"
                className="px-1 text-base font-semibold leading-none text-red-500 transition-colors hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One country's holidays as a sub-section: this year's list, a "Load" button
// for the built-in IE/TR seeders, and a manual add form. Used inside the
// per-country card.
export function CountryHolidays({
  country,
  list,
}: {
  country: Doc<"countries">;
  list: { _id: Id<"holidays">; name: string; date: string }[];
}) {
  const importHolidays = useAction(api.holidays.importFromNager);
  const addHoliday = useMutation(api.holidays.add);
  const removeHoliday = useMutation(api.holidays.remove);
  const year = new Date().getFullYear();
  const [draft, setDraft] = useState({ date: "", name: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Re-pull this year + next from Nager. Idempotent — adds any missing dates;
  // it won't overwrite or remove ones already there (delete those by hand).
  async function reload() {
    setBusy(true);
    setMsg(null);
    try {
      const { added } = await importHolidays({
        country: country.code,
        years: [year, year + 1],
      });
      setMsg(added > 0 ? `+${added} added` : "Up to date");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="mt-3 rounded-md border border-dashed border-border p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Public holidays · {year}
          <InfoHint>
            Auto-downloaded from Nager when the country is added. “Reload”
            re-pulls this year and next, adding any missing dates — it won’t
            overwrite ones you’ve edited.
          </InfoHint>
        </span>
        <span className="flex items-center gap-2">
          {msg && <span className="text-[11px] text-muted">{msg}</span>}
          <button
            type="button"
            onClick={reload}
            disabled={busy}
            aria-label="Reload holidays from Nager"
            title="Reload from Nager"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-muted-bg hover:text-foreground disabled:opacity-50"
          >
            <svg
              className={busy ? "animate-spin" : ""}
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
        </span>
      </div>
      {sorted.length === 0 ? (
        <Empty>None loaded for {year}.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {sorted.map((h) => (
            <div
              key={h._id}
              className="group flex items-center justify-between rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted-bg"
            >
              <span>
                <span className="font-semibold text-foreground">
                  {fmtDate(h.date)}
                </span>
                <span className="ml-2 text-xs text-muted">{h.name}</span>
              </span>
              <button
                onClick={() => {
                  if (confirm(`Remove “${h.name}” (${fmtDate(h.date)})?`))
                    void removeHoliday({ holidayId: h._id });
                }}
                aria-label={`Remove ${h.name}`}
                title="Remove"
                className="px-1 text-base font-semibold leading-none text-red-500 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2">
        <SecondaryButton onClick={() => setOpen(true)}>
          + Add public holiday
        </SecondaryButton>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Add public holiday — ${country.name}`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.date || !draft.name.trim()) return;
            void addHoliday({
              date: draft.date,
              name: draft.name.trim(),
              country: country.code,
            });
            setDraft({ date: "", name: "" });
            setOpen(false);
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Date
            </label>
            <DatePicker
              value={draft.date}
              onChange={(iso) => setDraft({ ...draft, date: iso })}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. St Patrick's Day"
              className={`w-full ${inputCls}`}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setOpen(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={!draft.date || !draft.name.trim()}
            >
              Add
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function HolidaysCard() {
  const countries = useQuery(api.countries.list);
  const holidays = useQuery(api.holidays.list, {});
  const seedIrish = useMutation(api.holidays.seedIrish);
  const seedTurkish = useMutation(api.holidays.seedTurkish);
  const addHoliday = useMutation(api.holidays.add);
  const removeHoliday = useMutation(api.holidays.remove);

  const year = new Date().getFullYear();
  const [draft, setDraft] = useState({ date: "", name: "", country: "IE" });

  // Built-in seeders, keyed by country code.
  const seeders: Record<string, () => void> = {
    IE: () => void seedIrish({ year }),
    TR: () => void seedTurkish({ year }),
  };

  return (
    <Card>
      <SectionTitle>
        Public holidays · {year}
        <InfoHint>
          Excluded from leave-day counts and shown on the team calendar, per
          country.
        </InfoHint>
      </SectionTitle>
      <div className="mb-4 mt-3 grid gap-6 sm:grid-cols-2">
        {(countries ?? []).map((c) => (
          <HolidayColumn
            key={c._id}
            name={c.name}
            year={year}
            list={(holidays ?? [])
              .filter((h) => codeOf(h.country) === c.code && h.year === year)
              .sort((a, b) => a.date.localeCompare(b.date))}
            onLoad={seeders[c.code]}
            onRemove={(id) => void removeHoliday({ holidayId: id })}
          />
        ))}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.date || !draft.name.trim()) return;
          void addHoliday({
            date: draft.date,
            name: draft.name.trim(),
            country: draft.country,
          });
          setDraft({ date: "", name: "", country: draft.country });
        }}
      >
        <select
          value={draft.country}
          onChange={(e) => setDraft({ ...draft, country: e.target.value })}
          className={selectCls}
        >
          {(countries ?? []).map((c) => (
            <option key={c._id} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <DatePicker
          value={draft.date}
          onChange={(iso) => setDraft({ ...draft, date: iso })}
          className="w-44"
        />
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Holiday name"
          className={`flex-1 ${inputCls}`}
        />
        <PrimaryButton type="submit">Add</PrimaryButton>
      </form>
    </Card>
  );
}
