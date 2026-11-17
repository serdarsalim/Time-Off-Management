"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { countLeaveDays, formatRange } from "@/lib/dates";
import { PrimaryButton } from "./ui";
import { DatePicker } from "./DatePicker";

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground";

// The bits of an approved request this form needs. Structural so a decorated
// row from `myRequests` can be passed straight in.
export type AmendableRequest = {
  _id: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: number;
  startHalf?: boolean;
  endHalf?: boolean;
  halfPeriod?: "morning" | "afternoon";
};

// Propose new dates for leave that's already approved. Deliberately narrower
// than RequestForm — no leave type, no document. Changing what kind of leave
// it is isn't an amendment, it's a different request.
export function AmendForm({
  request,
  asUserId,
  onDone,
}: {
  request: AmendableRequest;
  asUserId?: string;
  onDone?: () => void;
}) {
  const requestAmendment = useMutation(api.leave.requestAmendment);

  const [startDate, setStartDate] = useState(request.startDate);
  const [endDate, setEndDate] = useState(request.endDate);
  const [startHalf, setStartHalf] = useState(request.startHalf ?? false);
  const [endHalf, setEndHalf] = useState(request.endHalf ?? false);
  const [halfPeriod, setHalfPeriod] = useState<"morning" | "afternoon">(
    request.halfPeriod ?? "morning",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const holidayRows = useQuery(api.holidays.inRange, {
    fromDate: startDate,
    toDate: endDate,
    asUserId: asUserId as any,
  });
  const workDays = useQuery(api.countries.workDaysForMe, {
    asUserId: asUserId as any,
  });
  const holidays = new Set((holidayRows ?? []).map((h) => h.date));
  const single = startDate === endDate;
  const days = countLeaveDays(
    startDate,
    endDate,
    holidays,
    startHalf,
    single ? false : endHalf,
    workDays ?? undefined,
  );

  const unchanged =
    startDate === request.startDate && endDate === request.endDate;
  const delta = days - request.days;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestAmendment({
        requestId: request._id as Id<"leaveRequests">,
        startDate,
        endDate,
        startHalf: startHalf || undefined,
        endHalf: single ? undefined : endHalf || undefined,
        halfPeriod: single && startHalf ? halfPeriod : undefined,
        reason: reason.trim(),
        asUserId: asUserId as Id<"users"> | undefined,
      });
      onDone?.();
    } catch (err) {
      setError(errorMessage(err, "Could not request the change."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-md border border-border bg-muted-bg px-3 py-2 text-sm">
        <div className="text-muted">Currently approved</div>
        <div className="font-medium text-foreground">
          {request.leaveTypeName} · {formatRange(request.startDate, request.endDate)}{" "}
          · {request.days} working day{request.days === 1 ? "" : "s"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            New from
          </span>
          <DatePicker
            value={startDate}
            onChange={(iso) => {
              setStartDate(iso);
              if (iso > endDate) setEndDate(iso);
            }}
          />
        </div>
        <div className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            New to
          </span>
          <DatePicker
            value={endDate}
            min={startDate}
            onChange={(iso) => setEndDate(iso)}
          />
        </div>
      </div>

      {single ? (
        <div className="rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={startHalf}
              onChange={(e) => setStartHalf(e.target.checked)}
              className="accent-accent"
            />
            Half day
          </label>
          {startHalf && (
            <div className="mt-2 flex gap-2">
              {(["morning", "afternoon"] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setHalfPeriod(p)}
                  className={`rounded-md border px-3 py-1 text-sm capitalize transition-colors ${
                    halfPeriod === p
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
              checked={startHalf}
              onChange={(e) => setStartHalf(e.target.checked)}
              className="accent-accent"
            />
            First day is a half day
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={endHalf}
              onChange={(e) => setEndHalf(e.target.checked)}
              className="accent-accent"
            />
            Last day is a half day
          </label>
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground">
          Why the change
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. coming back a day early"
          className={inputCls}
        />
      </label>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {days} working day{days === 1 ? "" : "s"}
          {delta !== 0 && (
            <span className="ml-1">
              ({delta > 0 ? `+${delta}` : delta} vs approved)
            </span>
          )}
        </span>
        <PrimaryButton
          type="submit"
          disabled={busy || days === 0 || unchanged || !reason.trim()}
        >
          {busy ? "Sending…" : "Request change"}
        </PrimaryButton>
      </div>
      {unchanged && (
        <p className="text-xs text-muted">
          Pick different dates to request a change.
        </p>
      )}
    </form>
  );
}
