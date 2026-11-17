"use client";

import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import {
  useImpersonatedUserId,
  stopImpersonation,
  getReturnPath,
} from "@/lib/impersonation";

export function ImpersonationBanner() {
  const router = useRouter();
  const impersonatedId = useImpersonatedUserId();
  const logStop = useMutation(api.users.logImpersonationStop);
  const target = useQuery(
    api.users.getById,
    impersonatedId ? { userId: impersonatedId } : "skip",
  );

  if (!impersonatedId) return null;

  const name = target?.name ?? "user…";

  function exit() {
    if (impersonatedId) void logStop({ targetUserId: impersonatedId });
    const back = getReturnPath();
    stopImpersonation();
    router.push(back ?? "/");
  }

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
      <div className="truncate">
        Acting as <span className="font-semibold">{name}</span>. Leave booked
        here is theirs, attributed to you in the activity log.
      </div>
      <button
        onClick={exit}
        className="shrink-0 rounded-md border border-amber-500/40 px-3 py-1 font-medium transition-colors hover:bg-amber-500/20"
      >
        Exit
      </button>
    </div>
  );
}
