import { describe, expect, it } from "vitest";
import {
  epochMsToTs,
  formatDate,
  formatRange,
  formatTime,
  parseSpanMs,
  resolveWindow,
  tsToEpochMs,
} from "../src/slack/time.js";

// A fixed "now": 2026-06-06 13:14:00 UTC (= 09:14 America/New_York, EDT -04:00).
const NOW = Date.UTC(2026, 5, 6, 13, 14, 0);

describe("parseSpanMs", () => {
  it("parses m/h/d", () => {
    expect(parseSpanMs("90m")).toBe(90 * 60_000);
    expect(parseSpanMs("24h")).toBe(24 * 3_600_000);
    expect(parseSpanMs("7d")).toBe(7 * 86_400_000);
  });
  it("rejects junk", () => {
    expect(parseSpanMs("7")).toBeUndefined();
    expect(parseSpanMs("7w")).toBeUndefined();
    expect(parseSpanMs("")).toBeUndefined();
  });
});

describe("resolveWindow", () => {
  it("--since spans back from now", () => {
    const w = resolveWindow({ since: "7d" }, NOW);
    expect(w.latestMs).toBe(NOW);
    expect(w.oldestMs).toBe(NOW - 7 * 86_400_000);
  });

  it("defaults to last 7 days", () => {
    const w = resolveWindow({}, NOW);
    expect(w.latestMs).toBe(NOW);
    expect(w.oldestMs).toBe(NOW - 7 * 86_400_000);
  });

  it("--from/--to dates bind to start/end of day in Eastern", () => {
    const w = resolveWindow({ from: "2026-04-23", to: "2026-04-29" }, NOW);
    // 2026-04-23 00:00 EDT = 04:00 UTC; 2026-04-29 23:59:59.999 EDT = 2026-04-30 03:59:59.999 UTC.
    expect(w.oldestMs).toBe(Date.UTC(2026, 3, 23, 4, 0, 0, 0));
    expect(w.latestMs).toBe(Date.UTC(2026, 3, 30, 3, 59, 59, 999));
  });

  it("resolves the correct YEAR (guards the 2025/2026 bug)", () => {
    const w = resolveWindow({ from: "2026-01-01", to: "2026-01-02" }, NOW);
    expect(formatDate(w.oldestMs, w.tz)).toBe("2026-01-01");
    // The same wall date a year earlier must resolve to 2025, not 2026.
    const prior = resolveWindow({ from: "2025-01-01", to: "2025-01-02" }, NOW);
    expect(formatDate(prior.oldestMs, prior.tz)).toBe("2025-01-01");
    expect(w.oldestMs - prior.oldestMs).toBeGreaterThan(360 * 86_400_000);
  });

  it("handles a standard-time (EST) date too", () => {
    // 2026-01-15 00:00 EST = 05:00 UTC (-05:00, no DST).
    const w = resolveWindow({ from: "2026-01-15", to: "2026-01-15" }, NOW);
    expect(w.oldestMs).toBe(Date.UTC(2026, 0, 15, 5, 0, 0, 0));
  });

  it("rejects an inverted window", () => {
    expect(() => resolveWindow({ from: "2026-06-01", to: "2026-05-01" }, NOW)).toThrow();
  });
});

describe("formatting", () => {
  it("formats date/time in Eastern", () => {
    expect(formatDate(NOW, "America/New_York")).toBe("2026-06-06");
    expect(formatTime(NOW, "America/New_York")).toBe("09:14");
  });
  it("range echo includes year + tz", () => {
    const w = resolveWindow({ since: "7d" }, NOW);
    expect(formatRange(w)).toBe("2026-05-30 09:14 → 2026-06-06 09:14 (America/New_York)");
  });
});

describe("ts conversion", () => {
  it("round-trips Slack ts ↔ epoch ms", () => {
    expect(tsToEpochMs("1717589640.123456")).toBe(1717589640123);
    expect(epochMsToTs(1717589640123)).toBe("1717589640.123000");
  });
});
