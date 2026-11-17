"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Shared colour key for the team calendar (month + year views). Everyone sees
// the same key — types are only omitted when an admin switches off "legend"
// for them in settings (the TR types mirror the IE colours, so showing both
// would just repeat the key in two languages).
export function CalendarLegend() {
  const leaveTypes = useQuery(api.leaveTypes.list, {});
  const shown = (leaveTypes ?? []).filter((t) => t.showInLegend !== false);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {shown.map((t) => (
        <span key={t._id} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: t.color }}
          />
          {t.name}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/30" />
        Public holiday
      </span>
    </div>
  );
}
