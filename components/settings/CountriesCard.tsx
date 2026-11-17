"use client";

import { useMutation, useQuery } from "convex/react";
import { errorMessage } from "@/lib/errors";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { InlineEdit, InlineSelect } from "@/components/InlineEdit";
import { InfoHint } from "@/components/InfoHint";
import { Card, Empty } from "@/components/ui";
import { CountryTypes } from "@/components/settings/LeaveTypesCard";
import { CountryHolidays } from "@/components/settings/HolidaysCard";


// One country: its leave-year mode, paid-time-off rule, and remove.
function CountryRow({
  country,
  types,
  holidays,
}: {
  country: Doc<"countries">;
  types: Doc<"leaveTypes">[];
  holidays: Doc<"holidays">[];
}) {
  const updateCountry = useMutation(api.countries.update);
  const removeCountry = useMutation(api.countries.remove);
  const setWorkDays = useMutation(api.countries.setWorkDays);
  const setAnnualConfig = useMutation(api.countries.setAnnualConfig);

  const isAnniversary = country.leaveYearMode === "anniversary";

  // Working week as day indices (0=Sun … 6=Sat); unset → Mon–Fri.
  const workDays = new Set(
    country.workDays && country.workDays.length > 0
      ? country.workDays
      : [1, 2, 3, 4, 5],
  );

  function toggleWorkDay(dow: number) {
    const next = new Set(workDays);
    if (next.has(dow)) next.delete(dow);
    else next.add(dow);
    if (next.size === 0) return; // a country needs at least one working day
    void setWorkDays({
      countryId: country._id,
      workDays: [...next].sort((a, b) => a - b),
    });
  }

  async function remove() {
    if (!confirm(`Remove ${country.name}? This can't be undone.`)) return;
    try {
      await removeCountry({ countryId: country._id });
    } catch (err) {
      alert(errorMessage(err, "Could not remove country."));
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="rounded bg-muted-bg px-1.5 py-0.5 text-[11px] font-semibold text-muted">
            {country.code}
          </span>
          <InlineEdit
            value={country.name}
            className="text-sm font-semibold text-foreground"
            onSave={(v) => {
              const n = v.trim();
              if (n && n !== country.name)
                void updateCountry({ countryId: country._id, name: n });
            }}
          />
        </span>
        <button
          onClick={() => void remove()}
          aria-label="Remove country"
          className="rounded-md px-1.5 text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>

      {/* Leave-year rule — reads as plain text, click the value to change it. */}
      <div className="mt-1.5 flex items-center gap-1.5 pl-0.5 text-xs text-muted">
        <span>Leave year</span>
        <InlineSelect
          value={country.leaveYearMode}
          onChange={(v) =>
            void updateCountry({
              countryId: country._id,
              leaveYearMode: v as "calendar" | "anniversary",
            })
          }
          options={[
            { value: "calendar", label: "Calendar year" },
            { value: "anniversary", label: "Anniversary year" },
          ]}
        />
        <InfoHint width="w-80">
          <span className="block">
            <strong className="font-semibold text-foreground">
              Calendar year
            </strong>{" "}
            — everyone&apos;s allowance resets on 1 January, whatever date they
            joined. Example: Aoife starts on 1 September 2026 with a 20-day
            allowance (pro-rated to ~7 days for Sep–Dec). Those days expire on 31
            December, and she gets a fresh 20 on 1 January 2027.
          </span>
          <span className="mt-2 block">
            <strong className="font-semibold text-foreground">
              Anniversary year
            </strong>{" "}
            — each person&apos;s leave year runs from their own start date.
            Example: because Aoife started on 1 September, her year runs 1 Sep →
            31 Aug and her balance resets every 1 September. Use this when
            entitlements accrue from the join date or scale with tenure rather
            than the calendar.
          </span>
        </InfoHint>
      </div>

      {/* Working week — non-working days don't count against leave and show
          shaded in the calendar. */}
      <div className="mt-3 rounded-md border border-dashed border-border p-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Working week
          <InfoHint>
            Days left off are non-working — shaded in the calendar and excluded
            from leave totals.
          </InfoHint>
        </div>
        <div className="flex flex-wrap gap-1">
          {[
            { dow: 1, label: "Mon" },
            { dow: 2, label: "Tue" },
            { dow: 3, label: "Wed" },
            { dow: 4, label: "Thu" },
            { dow: 5, label: "Fri" },
            { dow: 6, label: "Sat" },
            { dow: 0, label: "Sun" },
          ].map(({ dow, label }) => {
            const on = workDays.has(dow);
            return (
              <button
                key={dow}
                type="button"
                onClick={() => toggleWorkDay(dow)}
                aria-pressed={on}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted hover:bg-muted-bg"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional first-year rule */}
      <div className="mt-3 rounded-md border border-dashed border-border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            First-year rule
            <InfoHint>
              Optional. When on, the paid time off type grants a fixed
              allowance in someone’s first (partial) leave-year instead of
              pro-rating. In anniversary-year countries it’s also locked for the
              first few months. Per-person overrides still add extra.
            </InfoHint>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!country.firstYearRule}
            aria-label="Toggle first-year rule"
            onClick={() =>
              void setAnnualConfig({
                countryId: country._id,
                firstYearRule: !country.firstYearRule,
              })
            }
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              country.firstYearRule ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                country.firstYearRule ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {country.firstYearRule && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              First-year allowance
              <InlineEdit
                value={String(country.firstYearDays ?? 5)}
                type="number"
                className="w-12"
                onSave={(v) =>
                  void setAnnualConfig({
                    countryId: country._id,
                    firstYearDays: Math.max(0, Math.floor(Number(v) || 0)),
                  })
                }
              />
              days
            </label>
            {isAnniversary && (
              <label className="flex items-center gap-1.5">
                Locked for
                <InlineEdit
                  value={String(country.lockMonths ?? 6)}
                  type="number"
                  className="w-12"
                  onSave={(v) =>
                    void setAnnualConfig({
                      countryId: country._id,
                      lockMonths: Math.max(0, Math.floor(Number(v) || 0)),
                    })
                  }
                />
                months
              </label>
            )}
          </div>
        )}
      </div>

      <CountryTypes country={country} types={types} />
      <CountryHolidays country={country} list={holidays} />
    </Card>
  );
}

export function CountriesCard({ query = "" }: { query?: string }) {
  const countries = useQuery(api.countries.list);
  const allTypes = useQuery(api.leaveTypes.list, {});
  const allHolidays = useQuery(api.holidays.list, {});
  const thisYear = new Date().getFullYear();

  // Header search: a country stays visible when the query matches its name or
  // code, or anything inside it (a leave type, a holiday). A query matching
  // the card's own title keeps everything — searching for the card means
  // wanting what is in it. No matches at all and the card hides entirely.
  const q = query.trim().toLowerCase();
  const titleMatches = q !== "" && "countries".includes(q);
  const matching = (countries ?? []).filter((c) => {
    if (q === "" || titleMatches) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (allTypes ?? []).some(
        (t) =>
          (t.countryCode ?? "IE") === c.code &&
          t.name.toLowerCase().includes(q),
      ) ||
      (allHolidays ?? []).some(
        (h) =>
          h.country === c.code &&
          h.year === thisYear &&
          h.name.toLowerCase().includes(q),
      )
    );
  });
  if (q !== "" && countries !== undefined && matching.length === 0) return null;

  // Each country is its own card on the plane — one subject, one card. A
  // shared "Countries" wrapper put a frame around frames, and its title only
  // repeated what the page header and the cards themselves already say.
  return countries === undefined ? (
    <Empty>Loading…</Empty>
  ) : countries.length === 0 ? (
    <Empty>No countries yet — add one with “Add country” above.</Empty>
  ) : (
    <div className="space-y-6">
      {matching.map((c) => (
        <CountryRow
          key={c._id}
          country={c}
          types={(allTypes ?? []).filter(
            (t) => (t.countryCode ?? "IE") === c.code,
          )}
          holidays={(allHolidays ?? []).filter(
            (h) => h.country === c.code && h.year === thisYear,
          )}
        />
      ))}
    </div>
  );
}
