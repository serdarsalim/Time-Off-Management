"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { todayISO } from "@/lib/dates";
import { PrimaryButton, FormRow } from "./ui";
import { DatePicker } from "./DatePicker";

const numCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground";

// Two callers, one form. Someone logging their own arrival goes through
// `report`; a manager on an employee's profile passes `forUserId` and the entry
// is filed against that person with the manager's name on the trail.
export function LatenessForm({
  onDone,
  asUserId,
  forUserId,
}: {
  onDone?: () => void;
  asUserId?: string;
  forUserId?: Id<"users">;
}) {
  const report = useMutation(api.lateness.report);
  const logFor = useMutation(api.lateness.logFor);

  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalMinutes =
    (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  const canSubmit = totalMinutes > 0 && reason.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) {
      setError(
        forUserId
          ? "Enter how late they arrived and a reason."
          : "Enter how late you were and a reason.",
      );
      return;
    }
    setBusy(true);
    try {
      if (forUserId) {
        await logFor({
          userId: forUserId,
          date,
          minutes: totalMinutes,
          reason: reason.trim(),
        });
      } else {
        await report({
          date,
          minutes: totalMinutes,
          reason: reason.trim(),
          asUserId: asUserId as Id<"users"> | undefined,
        });
      }
      setHours("");
      setMinutes("");
      setReason("");
      onDone?.();
    } catch (err) {
      setError(errorMessage(err, "Could not submit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-3">
      <FormRow label="Day">
        <DatePicker
          className="w-40"
          value={date}
          max={todayISO()}
          onChange={setDate}
        />
      </FormRow>

      {/* Hours and minutes are one answer, so they sit together and stay
          narrow — these are two-digit numbers, not sentences. */}
      <FormRow label="How late">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
            aria-label="Hours late"
            className={`${numCls} w-20`}
          />
          <span className="text-sm text-muted">h</span>
          <input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="0"
            aria-label="Minutes late"
            className={`${numCls} w-20`}
          />
          <span className="text-sm text-muted">min</span>
        </div>
      </FormRow>

      <FormRow label="Reason">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. train delay"
          className={`${numCls} w-full`}
        />
      </FormRow>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-auto flex justify-end pt-1">
        <PrimaryButton type="submit" disabled={busy || !canSubmit}>
          {busy ? "Saving…" : "Log late arrival"}
        </PrimaryButton>
      </div>
    </form>
  );
}
