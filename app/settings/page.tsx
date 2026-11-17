"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import { Empty } from "@/components/ui";
import { CountriesCard } from "@/components/settings/CountriesCard";
import { AddCountry } from "@/components/settings/AddCountry";
import { CalendarVisibilityCard } from "@/components/settings/CalendarVisibilityCard";
import { useEffectiveRole } from "@/lib/impersonation";

export default function TimeOffSettingsPage() {
  const role = useEffectiveRole();
  const canView = role === "superadmin";
  // Header search, looking across the whole configuration — a setting has to
  // be findable from wherever you happen to be standing. Each card filters
  // itself and hides entirely when nothing in it matches.
  const [q, setQ] = useState("");

  if (role !== undefined && !canView) {
    return (
      <AppShell>
        <Empty>Superadmins only.</Empty>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Time-off configuration"
      titleInfo={
        <InfoHint>
          Countries, their leave types, public holidays, and calendar
          visibility.
        </InfoHint>
      }
      search={{ value: q, onChange: setQ }}
    >

      {/* The primary action sits above the card it acts on, right-aligned. */}
      <div className="mb-3 flex justify-end">
        <AddCountry />
      </div>

      <CountriesCard query={q} />

      <CalendarVisibilityCard query={q} />
    </AppShell>
  );
}
