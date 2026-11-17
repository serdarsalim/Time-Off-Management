"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { InfoHint } from "@/components/InfoHint";
import { Empty } from "@/components/ui";
import { LeaveTakenReport } from "@/components/LeaveTakenReport";
import { useEffectiveRole } from "@/lib/impersonation";

// Company reports live on their own page — the dashboard links here instead of
// embedding the full tables. Approvers only (admins + office managers), same
// gate as the underlying reports queries.
export default function ReportsPage() {
  const role = useEffectiveRole();
  const canView =
    role === "admin" || role === "superadmin" || role === "office_manager";
  const [q, setQ] = useState("");

  if (role !== undefined && !canView) {
    return (
      <AppShell>
        <Empty>You don&apos;t have access to reports.</Empty>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Reports"
      titleInfo={
        <InfoHint>
          Leave taken across the company, filterable and exportable.
        </InfoHint>
      }
      search={{ value: q, onChange: setQ }}
    >
      <LeaveTakenReport query={q} />
    </AppShell>
  );
}
