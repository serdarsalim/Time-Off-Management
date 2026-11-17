"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useImpersonatedUserId } from "@/lib/impersonation";
import { StatusPill } from "@/components/ui";

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function destFor(type: string): string {
  if (type === "leave.requested") return "/approvals";
  // An amendment still needs deciding, so it lands in the same queue. Its
  // decision goes the other way, to the employee — that falls through.
  if (type === "leave.amendment") return "/approvals";
  if (type === "lateness.reported") return "/employees";
  if (type === "leave.cancelled") return "/calendar";
  return "/requests";
}

export function NotificationBell() {
  const router = useRouter();
  const impersonatedId = useImpersonatedUserId();
  const asUserId = (impersonatedId ?? undefined) as Id<"users"> | undefined;
  const [open, setOpen] = useState(false);
  const items = useQuery(api.notifications.list, { asUserId });
  const unread = useQuery(api.notifications.unreadCount, { asUserId }) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  function onClickItem(id: Id<"notifications">, type: string) {
    void markRead({ notificationId: id, asUserId });
    setOpen(false);
    router.push(destFor(type));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.06]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-fg ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-semibold text-foreground">
                Notifications
              </span>
              {unread > 0 && (
                <button
                  onClick={() => void markAllRead({ asUserId })}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="thin-scroll max-h-96 overflow-y-auto">
              {items === undefined ? (
                <div className="px-4 py-6 text-center text-sm text-muted">
                  Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted">
                  You're all caught up.
                </div>
              ) : (
                <ul>
                  {items.map((n) => (
                    <li key={n._id}>
                      <button
                        onClick={() => onClickItem(n._id, n.type)}
                        className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-muted-bg ${
                          n.readAt ? "" : "bg-accent-soft/50"
                        }`}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {n.title}
                          </span>
                          {!n.readAt && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                          )}
                        </span>
                        {n.body && (
                          <span className="text-xs text-muted">{n.body}</span>
                        )}
                        <span className="mt-0.5 flex items-center gap-2">
                          {n.requestStatus && (
                            <StatusPill status={n.requestStatus} />
                          )}
                          <span className="text-[11px] text-muted">
                            {timeAgo(n.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
      )}
    </div>
  );
}
