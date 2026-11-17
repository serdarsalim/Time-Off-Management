"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, SectionTitle } from "@/components/ui";

const OPTIONS = [
  {
    value: "company" as const,
    label: "Whole company",
    hint: "Employees see everyone's approved leave — name, dates and leave type. The note stays private.",
  },
  {
    value: "department" as const,
    label: "Same department only",
    hint: "Employees see only leave from people in their own department. Approvers always see everyone.",
  },
];

// Org-wide toggle for what regular employees see on the team calendar.
export function CalendarVisibilityCard({ query = "" }: { query?: string }) {
  const settings = useQuery(api.settings.get);
  const setScope = useMutation(api.settings.setCalendarScope);

  // Header search: hide the card when nothing in it matches — its title or
  // any option's label or hint.
  const q = query.trim().toLowerCase();
  if (
    q !== "" &&
    !"team calendar visibility".includes(q) &&
    !OPTIONS.some(
      (o) =>
        o.label.toLowerCase().includes(q) || o.hint.toLowerCase().includes(q),
    )
  ) {
    return null;
  }

  return (
    <Card className="mt-6">
      <SectionTitle>Team calendar visibility</SectionTitle>
      <div className="flex flex-col gap-2 sm:flex-row">
        {OPTIONS.map((o) => {
          const active = settings?.calendarScope === o.value;
          return (
            <button
              key={o.value}
              disabled={settings === undefined}
              onClick={() => void setScope({ calendarScope: o.value })}
              aria-pressed={active}
              className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                active
                  ? "border-accent bg-accent/5"
                  : "border-border hover:bg-muted-bg"
              }`}
            >
              <span
                className={`block text-sm font-medium ${
                  active ? "text-accent" : "text-foreground"
                }`}
              >
                {o.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
