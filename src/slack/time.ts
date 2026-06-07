import { AxiError } from "axi-sdk-js";

/**
 * Human time in, Slack ts out — the year-correctness guard. The agent never produces an epoch; we
 * parse spans/dates in a timezone (Eastern by default) and echo the resolved window back with explicit
 * year. See specs/behaviors/time-and-completeness.md. All functions are pure (now is injected).
 */

export const DEFAULT_TZ = "America/New_York";
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedWindow {
  /** Inclusive lower bound, epoch ms. */
  oldestMs: number;
  /** Inclusive upper bound, epoch ms. */
  latestMs: number;
  tz: string;
}

/** Parse a relative span like `90m`, `24h`, `7d` into milliseconds; undefined if it doesn't match. */
export function parseSpanMs(input: string): number | undefined {
  const m = /^(\d+)(m|h|d)$/.exec(input.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2];
  const factor = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * factor;
}

/** Offset (ms) of a timezone at a given instant: (wall-clock read as UTC) − actual epoch. */
function tzOffsetMs(epochMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - epochMs;
}

/**
 * Convert a wall-clock time in `tz` to epoch ms (DST-correct via a two-pass offset). Offset math runs
 * on a millisecond-free instant (Intl parts have no ms, and real offsets are whole-minute); `ms` is
 * added back at the end.
 */
function zonedToEpochMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
  tz: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, 0);
  let epoch = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(epoch, tz);
  if (second !== epoch) epoch = second;
  return epoch + ms;
}

/**
 * Resolve a `when` token (date `2026-04-23`, datetime `2026-04-23T14:00`, or relative span `7d`) to
 * epoch ms in `tz`. A bare date binds to start or end of day per `boundary`.
 */
function parseWhen(when: string, tz: string, boundary: "start" | "end", now: number): number {
  const span = parseSpanMs(when);
  if (span !== undefined) return now - span;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when.trim());
  if (dateMatch) {
    const [, y, mo, d] = dateMatch.map(Number);
    return boundary === "start"
      ? zonedToEpochMs(y, mo, d, 0, 0, 0, 0, tz)
      : zonedToEpochMs(y, mo, d, 23, 59, 59, 999, tz);
  }

  const dtMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(when.trim());
  if (dtMatch) {
    const [, y, mo, d, h, mi, s] = dtMatch.map((v) => Number(v ?? 0));
    return zonedToEpochMs(y, mo, d, h, mi, Number.isFinite(s) ? s : 0, 0, tz);
  }

  throw new AxiError(`Could not parse time '${when}'`, "USAGE", [
    "Use a date (2026-04-23), datetime (2026-04-23T14:00), or span (7d, 24h, 90m)",
  ]);
}

/** Resolve `--since` / `--from` / `--to` into an explicit window. Defaults to the last 7 days. */
export function resolveWindow(
  opts: { since?: string; from?: string; to?: string; tz?: string },
  now: number,
): ResolvedWindow {
  const tz = opts.tz ?? DEFAULT_TZ;

  if (opts.since !== undefined) {
    const span = parseSpanMs(opts.since);
    if (span === undefined) {
      throw new AxiError(`Invalid --since '${opts.since}'`, "USAGE", ["Use a span like 7d, 24h, or 90m"]);
    }
    return { oldestMs: now - span, latestMs: now, tz };
  }

  const latestMs = opts.to !== undefined ? parseWhen(opts.to, tz, "end", now) : now;
  const oldestMs = opts.from !== undefined ? parseWhen(opts.from, tz, "start", now) : now - DEFAULT_WINDOW_MS;

  if (oldestMs > latestMs) {
    throw new AxiError("Resolved window is empty (--from is after --to)", "USAGE", [
      "Check the dates; --from must be earlier than --to",
    ]);
  }
  return { oldestMs, latestMs, tz };
}

function partsInTz(epochMs: number, tz: string): Record<string, string> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(dtf.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
}

/** `YYYY-MM-DD` in tz. */
export function formatDate(epochMs: number, tz: string): string {
  const p = partsInTz(epochMs, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `HH:MM` in tz (24h). */
export function formatTime(epochMs: number, tz: string): string {
  const p = partsInTz(epochMs, tz);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${hour}:${p.minute}`;
}

/** `YYYY-MM-DD HH:MM` in tz — used in the resolved-range echo so the year is always explicit. */
export function formatDateTime(epochMs: number, tz: string): string {
  return `${formatDate(epochMs, tz)} ${formatTime(epochMs, tz)}`;
}

/** The resolved-range header value, e.g. `2026-05-30 09:14 → 2026-06-06 09:14 (America/New_York)`. */
export function formatRange(w: ResolvedWindow): string {
  return `${formatDateTime(w.oldestMs, w.tz)} → ${formatDateTime(w.latestMs, w.tz)} (${w.tz})`;
}

/** Slack ts (`1717589640.123456`) → epoch ms. */
export function tsToEpochMs(ts: string): number {
  return Math.round(Number.parseFloat(ts) * 1000);
}

/** epoch ms → Slack ts string (seconds with microseconds). */
export function epochMsToTs(epochMs: number): string {
  return (epochMs / 1000).toFixed(6);
}
