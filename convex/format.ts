// Server-side date formatting for notification/email copy.
export function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatRange(startISO: string, endISO: string): string {
  if (startISO === endISO) return formatDay(startISO);
  return `${formatDay(startISO)} – ${formatDay(endISO)}`;
}

// "90" → "1h 30m", "45" → "45m", "120" → "2h". Used in lateness copy.
export function formatLateness(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h && rem) return `${h}h ${rem}m`;
  if (h) return `${h}h`;
  return `${rem}m`;
}
