/** Database timestamps without an offset are UTC, never the browser's local time. */
export function parseUtc(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(trimmed)) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed) ? trimmed : `${trimmed}Z`;
  const time = Date.parse(zoned);
  return Number.isFinite(time) ? time : null;
}

export function timestampDisplay(value: string | null | undefined, timeZone?: string, locale?: string) {
  const time = parseUtc(value);
  if (time === null) return null;
  const formatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset", ...(timeZone ? { timeZone } : {}) });
  return { utc: new Date(time).toISOString(), local: formatter.format(time), zone: formatter.resolvedOptions().timeZone };
}

export function formatTimestamp(value: string | null | undefined): string {
  const display = timestampDisplay(value);
  return display ? `${display.local} (local · ${display.zone}); UTC: ${display.utc}` : "—";
}

/** Formats browser-local 24h short time "HH:MM" for compact message headers. */
export function formatShortTime(value: string | null | undefined): string {
  const time = parseUtc(value);
  if (time === null) return "—";
  const d = new Date(time);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
