"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { countLeaveDays, todayISO } from "@/lib/dates";
import { TypeDot, PrimaryButton, FormRow } from "./ui";
import { DatePicker } from "./DatePicker";
import { Balance, BalanceNote } from "./BalanceWarning";

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground";

// A leave type carries a colour that means something — it's what the leave
// shows as on the calendar, and what the legend teaches. A native <select>
// can't render it, so this is a button and a popover instead: dot and name
// both places. Closes on pick, outside click or Escape.
function TypeSelect({
  types,
  value,
  onChange,
}: {
  types: { _id: string; name: string; color: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const selected = types.find((t) => t._id === value);

  return (
    <div className="relative w-full max-w-xs" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors hover:bg-muted-bg focus:border-foreground"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <TypeDot color={selected.color} />
              <span className="truncate text-foreground">{selected.name}</span>
            </>
          ) : (
            <span className="text-muted">Pick a leave type</span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-muted"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {types.map((t) => (
            <li key={t._id}>
              <button
                type="button"
                role="option"
                aria-selected={t._id === value}
                onClick={() => {
                  onChange(t._id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  t._id === value
                    ? "bg-accent-soft text-accent"
                    : "text-foreground hover:bg-muted-bg"
                }`}
              >
                <TypeDot color={t.color} />
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The subset of a leave request the form needs to prefill an amendment.
// Structural rather than the generated Doc type, so callers can hand over a
// decorated row from `myRequests` without casting.
export type EditableRequest = {
  _id: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  note?: string;
  startHalf?: boolean;
  endHalf?: boolean;
  halfPeriod?: "morning" | "afternoon";
  documentName?: string | null;
};

export function RequestForm({
  onDone,
  asUserId,
  adminDirect = false,
  editRequest,
}: {
  onDone?: () => void;
  asUserId?: string;
  // Admin entering leave straight onto someone's record (asUserId = target):
  // lands as approved via leave.adminCreate, no approval round-trip.
  adminDirect?: boolean;
  // Amending an existing PENDING request instead of creating one. Same
  // fields, same validation — the row is rewritten and stays pending.
  editRequest?: EditableRequest;
}) {
  const types = useQuery(api.leaveTypes.listForMe, {
    asUserId: asUserId as any,
  });
  const request = useMutation(api.leave.request);
  const adminCreate = useMutation(api.leave.adminCreate);
  const editPending = useMutation(api.leave.editPending);
  const generateUploadUrl = useMutation(api.leave.generateUploadUrl);

  // Prefilled from the request under amendment, otherwise a blank today/today
  // booking. The form is mounted fresh per edit (it lives in a modal), so
  // initial state is enough — no syncing effect needed.
  const [leaveTypeId, setLeaveTypeId] = useState<string>(
    editRequest?.leaveTypeId ?? "",
  );
  const [startDate, setStartDate] = useState(editRequest?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(editRequest?.endDate ?? todayISO());
  const [note, setNote] = useState(editRequest?.note ?? "");
  const [startHalf, setStartHalf] = useState(editRequest?.startHalf ?? false);
  const [endHalf, setEndHalf] = useState(editRequest?.endHalf ?? false);
  // Morning vs afternoon isn't asked any more — whoever needs to know can read
  // it in the note, and the picker appearing on tick shoved the whole form
  // down. Carried through rather than dropped so amending a request booked
  // before this change doesn't quietly wipe what it already says.
  const halfPeriod = editRequest?.halfPeriod;
  const [file, setFile] = useState<File | null>(null);
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
  // Priced against the leave year the request lands in, not today's — booking
  // across a reset spends the new period's days.
  const balances = useQuery(api.allowances.myAllowance, {
    forDate: startDate,
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
  const effectiveType = leaveTypeId || types?.[0]?._id || "";
  const selectedType = types?.find((t) => t._id === effectiveType);
  // What this booking does to the balance. Null for unlimited types, which
  // keep no balance to spend. An amendment's own days are already charged if
  // it was approved, but a pending one isn't — and only pending requests reach
  // this form, so there's nothing to credit back.
  const row = balances?.balances.find((b) => b.leaveTypeId === effectiveType);
  const balance: Balance =
    row && row.deductsAllowance
      ? { before: row.remainingDays, after: row.remainingDays - days }
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effectiveType) {
      setError("Pick a leave type.");
      return;
    }
    setBusy(true);
    try {
      // Optional supporting document — upload first, then reference it.
      let documentId: Id<"_storage"> | undefined;
      let documentName: string | undefined;
      if (file && selectedType?.allowDoc) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) throw new Error("Could not upload the document.");
        const { storageId } = (await res.json()) as { storageId: string };
        documentId = storageId as Id<"_storage">;
        documentName = file.name;
      }
      const common = {
        leaveTypeId: effectiveType as Id<"leaveTypes">,
        startDate,
        endDate,
        note: note.trim() || undefined,
        startHalf: startHalf || undefined,
        endHalf: single ? undefined : endHalf || undefined,
        halfPeriod: single && startHalf ? halfPeriod : undefined,
        documentId,
        documentName,
      };
      if (editRequest) {
        await editPending({
          ...common,
          requestId: editRequest._id as Id<"leaveRequests">,
          asUserId: asUserId as Id<"users"> | undefined,
        });
      } else if (adminDirect) {
        if (!asUserId) throw new Error("No target user.");
        await adminCreate({ ...common, userId: asUserId as Id<"users"> });
      } else {
        await request({
          ...common,
          asUserId: asUserId as Id<"users"> | undefined,
        });
      }
      // Amending closes the dialog, so leave its fields alone — resetting
      // them would flash a blank form on the way out.
      if (!editRequest) {
        setNote("");
        setStartHalf(false);
        setEndHalf(false);
      }
      setFile(null);
      onDone?.();
    } catch (err) {
      setError(errorMessage(err, "Could not submit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-3">
      <FormRow label="Leave type">
        {types && types.length === 0 ? (
          <span className="block pt-2 text-sm text-muted">
            No leave types yet. An admin needs to add them.
          </span>
        ) : (
          <TypeSelect
            types={types ?? []}
            value={effectiveType}
            onChange={setLeaveTypeId}
          />
        )}
      </FormRow>

      {/* Dates and the half-day question are one decision, so they share a
          row. A single-day booking asks "half day?"; a range asks it of the
          two ends separately, since the middle is always whole. */}
      <FormRow label="Dates">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <DatePicker
            className="w-40"
            value={startDate}
            onChange={(iso) => {
              setStartDate(iso);
              if (iso > endDate) setEndDate(iso);
            }}
          />
          <span className="text-sm text-muted">→</span>
          <DatePicker
            className="w-40"
            value={endDate}
            min={startDate}
            onChange={(iso) => setEndDate(iso)}
          />
          {single ? (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={startHalf}
                onChange={(e) => setStartHalf(e.target.checked)}
                className="accent-accent"
              />
              Half day
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={startHalf}
                  onChange={(e) => setStartHalf(e.target.checked)}
                  className="accent-accent"
                />
                First day half
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={endHalf}
                  onChange={(e) => setEndHalf(e.target.checked)}
                  className="accent-accent"
                />
                Last day half
              </label>
            </>
          )}
        </div>
      </FormRow>

      <FormRow label="Note">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. family trip"
          className={inputCls}
        />
      </FormRow>

      {/* Supporting document — only for types that allow one (e.g. sick
          leave), and always optional. */}
      {selectedType?.allowDoc && (
        <FormRow label="Document">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f && f.size > 10 * 1024 * 1024) {
                setError("Document too large — 10 MB max.");
                e.target.value = "";
                return;
              }
              setError(null);
              setFile(f);
            }}
            className="block w-full pt-1.5 text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted-bg"
          />
          {/* An amendment keeps whatever is already attached unless a new
              file is picked, so say what's on there now. */}
          {editRequest?.documentName && !file && (
            <span className="mt-1 block text-xs text-muted">
              Currently attached: {editRequest.documentName}
            </span>
          )}
        </FormRow>
      )}

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* What it costs and what it leaves. Nothing here blocks the booking —
          running out is allowed — but nobody should find out they went under
          from their approver. */}
      <div className="mt-auto flex items-end justify-between gap-3 pt-1">
        <div>
          <span className="text-sm text-muted">
            {days} working day{days === 1 ? "" : "s"}
          </span>
          <BalanceNote
            balance={balance}
            label={selectedType?.name}
            outcome={
              adminDirect ? "once added" : "after your leave is approved"
            }
          />
        </div>
        <PrimaryButton type="submit" disabled={busy || days === 0}>
          {busy
            ? "Saving…"
            : editRequest
              ? "Save changes"
              : adminDirect
                ? "Add leave (approved)"
                : "Request leave"}
        </PrimaryButton>
      </div>
    </form>
  );
}
