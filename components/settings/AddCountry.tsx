"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { InfoHint } from "@/components/InfoHint";
import { Combobox } from "@/components/Combobox";
import { COUNTRY_OPTIONS } from "@/lib/countryOptions";

const COMBO_OPTIONS = COUNTRY_OPTIONS.map((c) => ({
  value: c.code,
  label: c.name,
  hint: c.source === "manual" ? "manual" : undefined,
}));

const fieldCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground";

// "Add country" button that opens an inline dropdown (popover) with the country
// picker — code auto-derived and read-only, holidays downloaded from Nager on
// add. Lives in the Time-off configuration header.
export function AddCountry() {
  const createCountry = useMutation(api.countries.create);
  const importHolidays = useAction(api.holidays.importFromNager);

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"calendar" | "anniversary">("calendar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const selected = COUNTRY_OPTIONS.find((c) => c.code === code);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Pick a country.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await createCountry({
        code: selected.code,
        name: selected.name,
        leaveYearMode: mode,
      });
      if (selected.source === "nager") {
        setStatus("Downloading holidays…");
        const year = new Date().getFullYear();
        const { added } = await importHolidays({
          country: selected.code,
          years: [year, year + 1],
        });
        setStatus(
          `Added ${selected.name} — ${added} holiday${added === 1 ? "" : "s"} for ${year}–${year + 1}.`,
        );
      } else {
        setStatus(
          `Added ${selected.name}. Add its holidays from the Holidays card below.`,
        );
      }
      // List updates live; reset the picker so they can add another.
      setCode("");
      setMode("calendar");
    } catch (err) {
      setError(errorMessage(err, "Could not add country."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <PrimaryButton onClick={() => setOpen((o) => !o)}>
        Add country
      </PrimaryButton>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-border bg-card p-4 shadow-lg">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Country
              </label>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Combobox
                    value={code}
                    onChange={(v) => {
                      setCode(v);
                      setStatus(null);
                    }}
                    options={COMBO_OPTIONS}
                    placeholder="Search countries…"
                  />
                </div>
                {/* Code is derived from the country and not editable. */}
                <span className="w-12 shrink-0 rounded-md border border-border bg-muted-bg py-2 text-center text-sm font-medium text-muted">
                  {selected?.code ?? "—"}
                </span>
              </div>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                Leave year
                <InfoHint>
                  Calendar year: everyone&apos;s allowance resets on 1 January.
                  Anniversary year: each person&apos;s year runs from their own
                  start date — drives tenure-based and pro-rated entitlements.
                </InfoHint>
              </label>
              <select
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "calendar" | "anniversary")
                }
                className={fieldCls}
              >
                <option value="calendar">Calendar year</option>
                <option value="anniversary">Anniversary year</option>
              </select>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            {status && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                {status}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-0.5">
              <SecondaryButton type="button" onClick={() => setOpen(false)}>
                Close
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={busy || !selected}>
                {busy ? "Adding…" : "Add"}
              </PrimaryButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
