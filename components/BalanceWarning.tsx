"use client";

import { Modal } from "@/components/Modal";
import { PrimaryButton, SecondaryButton } from "@/components/ui";

// What a decision would do to the applicant's balance. Null for leave types
// that don't keep one.
export type Balance = { before: number; after: number } | null;

// Days come in halves, so keep the decimal and only drop the plural on one.
// A real minus sign rather than a hyphen — these numbers get read in prose.
export function formatDays(n: number) {
  return `${n < 0 ? `−${Math.abs(n)}` : n} day${Math.abs(n) === 1 ? "" : "s"}`;
}

// Whether saying yes to this puts the person under water.
export function goesNegative(balance: Balance): balance is NonNullable<Balance> {
  return balance !== null && balance.after < 0;
}

// Leave books through even when the allowance has run out, so whether the
// overdraft is acceptable is a judgement someone has to make — which only
// works if the screen says the numbers out loud. Every variant reads the same
// shape: where the balance stands now → where this decision puts it. Quiet
// when it survives, coloured when it doesn't.
export function BalanceNote({
  balance,
  // The leave type this balance belongs to. Without it, "20 days left" never
  // says left of what — which stops being obvious the moment a country has
  // more than one type that deducts.
  label = "leave",
  // What makes the change real: "after your leave is approved" on a request
  // still waiting on a decision, "if you approve this" on the queue, "once
  // added" where it lands approved on the spot.
  outcome = "after this",
}: {
  balance: Balance;
  label?: string;
  outcome?: string;
}) {
  if (!balance) return null;
  const { before, after } = balance;
  // One sentence whatever the numbers do. A balance in the red announces
  // itself through the minus and the colour; rewording it as well just gives
  // the reader a second shape to parse.
  const line = `Current ${label} left: ${formatDays(before)} → ${formatDays(after)} ${outcome}.`;

  if (after >= 0) {
    return <div className="mt-1 text-sm text-muted">{line}</div>;
  }
  return (
    <div
      className={`mt-1.5 inline-flex items-center rounded-md px-2 py-0.5 text-sm font-medium ${
        before < 0
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
    >
      {line}
    </div>
  );
}

// Held between the approve click and the mutation. Nothing is blocked here —
// the approver just doesn't get to do it without having been told.
export function NegativeBalanceModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { name: string; balance: NonNullable<Balance> } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={pending !== null}
      onClose={onCancel}
      title="This puts them in the red"
    >
      {pending && (
        <>
          <p className="mb-4 text-sm text-muted">
            {pending.name}{" "}
            {pending.balance.before < 0
              ? `is already at ${formatDays(pending.balance.before)}`
              : `has ${formatDays(pending.balance.before)} left`}
            . Approving this takes them to{" "}
            <span className="font-medium text-foreground">
              {formatDays(pending.balance.after)}
            </span>
            . Nothing stops you — just make sure it&apos;s deliberate.
          </p>
          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
            <PrimaryButton onClick={onConfirm}>Approve anyway</PrimaryButton>
          </div>
        </>
      )}
    </Modal>
  );
}
