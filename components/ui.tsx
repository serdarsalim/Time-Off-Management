import { ReactNode } from "react";

// Label left, control right, sharing one baseline. The label column is a
// fixed width so every control down a form starts at the same x; below sm it
// stacks, where a gutter would leave the fields nothing to sit in.
export function FormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="sm:flex sm:items-start sm:gap-4">
      <div className="mb-1.5 pt-2 text-sm font-medium text-foreground sm:mb-0 sm:w-24 sm:shrink-0">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
      {children}
    </h2>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
    cancelled: "bg-muted-bg text-muted",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        map[status] ?? "bg-muted-bg text-muted"
      }`}
    >
      {status}
    </span>
  );
}

export function TypeDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={`h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={`rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted-bg disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
