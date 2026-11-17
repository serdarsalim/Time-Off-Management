"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, SectionTitle, Empty, PrimaryButton } from "@/components/ui";
import {
  FilterSelect,
  SortableTh,
  useSortedRows,
} from "@/components/SortableTable";
import { formatRange } from "@/lib/dates";
import { useImpersonatedUserId } from "@/lib/impersonation";

type DetailRow = {
  employeeName: string;
  department: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  approvedBy: string;
};

function toCsv(rows: DetailRow[]): string {
  const header = [
    "Employee",
    "Office",
    "Leave type",
    "From",
    "To",
    "Days",
    "Approved by",
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.employeeName,
        r.department,
        r.leaveType,
        r.startDate,
        r.endDate,
        r.days,
        r.approvedBy,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

// Company leave-taken report: days-per-person summary, full detail, CSV export.
// Lives on the admin Dashboard (replaces the standalone Reports page).
export function LeaveTakenReport({ query = "" }: { query?: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const asUserId = useImpersonatedUserId();
  const years = useQuery(api.reports.years, { asUserId: asUserId ?? undefined });
  const data = useQuery(api.reports.approvedLeave, {
    year,
    asUserId: asUserId ?? undefined,
  });

  const [deptFilter, setDeptFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  // The header search overrides the office/type filters while it's active: a
  // query must never fail to find a match those filters would hide.
  const q = query.trim().toLowerCase();
  const detail =
    q !== ""
      ? (data?.detail ?? []).filter((r) =>
          [r.employeeName, r.department, r.leaveType, r.approvedBy].some((v) =>
            v.toLowerCase().includes(q),
          ),
        )
      : (data?.detail ?? [])
          .filter((r) => (deptFilter ? r.department === deptFilter : true))
          .filter((r) => (typeFilter ? r.leaveType === typeFilter : true));
  const {
    sorted: detailRows,
    sort,
    toggle,
  } = useSortedRows(
    detail,
    {
      employee: (r) => r.employeeName,
      department: (r) => r.department,
      type: (r) => r.leaveType,
      dates: (r) => r.startDate,
      approvedBy: (r) => r.approvedBy,
      days: (r) => r.days,
    },
    { key: "dates", dir: "desc" },
  );
  const uniq = (vals: string[]) => [...new Set(vals)].sort();

  function download() {
    if (!data) return;
    const blob = new Blob([toCsv(detailRows)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leave-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectCls =
    "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground";

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Leave taken · {year}</SectionTitle>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={selectCls}
          >
            {(years ?? [year]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <PrimaryButton
            onClick={download}
            disabled={!data || detailRows.length === 0}
            title="Exports the detail table as currently filtered and sorted"
          >
            Export CSV
          </PrimaryButton>
        </div>
      </div>

      <div className="space-y-6">
        {/* The summary is a server aggregate over the whole year; while a
            search is active it would claim totals the visible rows don't
            support, so it steps aside rather than mislead. */}
        {q === "" && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted">
            Days per person
          </div>
          {data && data.summary.length > 0 ? (
            <ul className="space-y-1">
              {data.summary.map((s) => (
                <li
                  key={s.employeeName}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="text-foreground">{s.employeeName}</span>
                  <span className="font-semibold text-accent">{s.days}d</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No data.</Empty>
          )}
          {data && data.totalDays > 0 && (
            <div className="mt-3 border-t border-border pt-3 text-sm text-muted">
              Total: <span className="font-semibold">{data.totalDays}</span> days
            </div>
          )}
        </div>
        )}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted">Detail</div>
            {/* Hidden while searching — the search overrides them, and a
                control that can't take effect is noise. */}
            {q === "" && data && data.detail.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <FilterSelect
                  label="Filter by office"
                  value={deptFilter}
                  onChange={setDeptFilter}
                  options={[
                    { value: "", label: "All offices" },
                    ...uniq(data.detail.map((r) => r.department)).map((d) => ({
                      value: d,
                      label: d || "—",
                    })),
                  ]}
                />
                <FilterSelect
                  label="Filter by leave type"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { value: "", label: "All types" },
                    ...uniq(data.detail.map((r) => r.leaveType)).map((t) => ({
                      value: t,
                      label: t,
                    })),
                  ]}
                />
              </div>
            )}
          </div>
          {data === undefined ? (
            <Empty>Loading…</Empty>
          ) : detailRows.length === 0 ? (
            <Empty>No approved leave{q ? " matching your search" : deptFilter || typeFilter ? " matching the filters" : ""} in {year}.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs">
                    <SortableTh label="Employee" sortKey="employee" sort={sort} onToggle={toggle} />
                    <SortableTh label="Office" sortKey="department" sort={sort} onToggle={toggle} />
                    <SortableTh label="Type" sortKey="type" sort={sort} onToggle={toggle} />
                    <SortableTh label="Dates" sortKey="dates" sort={sort} onToggle={toggle} />
                    <SortableTh label="Approved by" sortKey="approvedBy" sort={sort} onToggle={toggle} />
                    <SortableTh label="Days" sortKey="days" sort={sort} onToggle={toggle} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r, i) => (
                    <tr key={i} className="border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]">
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {r.employeeName}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{r.department}</td>
                      <td className="px-4 py-2.5 text-muted">{r.leaveType}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {formatRange(r.startDate, r.endDate)}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{r.approvedBy}</td>
                      <td className="px-4 py-2.5 text-right text-foreground">
                        {r.days}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
