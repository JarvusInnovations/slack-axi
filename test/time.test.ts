import { describe, expect, it } from "vitest";
import {
  batchWindows,
  epochMsToTs,
  formatDate,
  formatRange,
  formatTime,
  parseSpanMs,
  resolveWindow,
  tsExclusiveBefore,
  tsToEpochMs,
} from "../src/slack/time.js";

// A fixed "now": 2026-06-06 13:14:00 UTC (= 09:14 America/New_York, EDT -04:00).
const NOW = Date.UTC(2026, 5, 6, 13, 14, 0);

describe("parseSpanMs", () => {
  it("parses m/h/d/w", () => {
    expect(parseSpanMs("90m")).toBe(90 * 60_000);
    expect(parseSpanMs("24h")).toBe(24 * 3_600_000);
    expect(parseSpanMs("7d")).toBe(7 * 86_400_000);
    expect(parseSpanMs("2w")).toBe(14 * 86_400_000);
  });
  it("rejects junk", () => {
    expect(parseSpanMs("7")).toBeUndefined();
    expect(parseSpanMs("7y")).toBeUndefined();
    expect(parseSpanMs("7mo")).toBeUndefined();
    expect(parseSpanMs("")).toBeUndefined();
  });
});

describe("resolveWindow", () => {
  it("--since spans back from now; end is exclusive (now+1) so now is included", () => {
    const w = resolveWindow({ since: "7d" }, NOW);
    expect(w.endMs).toBe(NOW + 1);
    expect(w.oldestMs).toBe(NOW - 7 * 86_400_000);
  });

  it("defaults to last 7 days", () => {
    const w = resolveWindow({}, NOW);
    expect(w.endMs).toBe(NOW + 1);
    expect(w.oldestMs).toBe(NOW - 7 * 86_400_000);
  });

  it("--from binds to start-of-day; --to binds to the NEXT day's midnight (exclusive)", () => {
    const w = resolveWindow({ from: "2026-04-23", to: "2026-04-29" }, NOW);
    // 2026-04-23 00:00 EDT = 04:00 UTC; exclusive end = 2026-04-30 00:00 EDT = 2026-04-30 04:00 UTC.
    expect(w.oldestMs).toBe(Date.UTC(2026, 3, 23, 4, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 3, 30, 4, 0, 0, 0));
    // …so all of April 29 is covered (the last instant is 2026-04-29 23:59:59.999999 Eastern).
    expect(formatDate(w.endMs - 1, w.tz)).toBe("2026-04-29");
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
  it("tsExclusiveBefore is exactly one microsecond before the instant", () => {
    expect(tsExclusiveBefore(1717589640123)).toBe("1717589640.122999");
    // crossing a whole second borrows correctly
    expect(tsExclusiveBefore(1717589640000)).toBe("1717589639.999999");
  });
});

describe("batchWindows (no gap, no overlap)", () => {
  function assertTiling(oldest: number, end: number, every: number) {
    const batches = batchWindows(oldest, end, every);
    expect(batches.length).toBeGreaterThan(0);
    expect(batches[0].startMs).toBe(oldest);
    expect(batches[batches.length - 1].endMs).toBe(end);
    for (let i = 0; i < batches.length - 1; i++) {
      // adjacent batches share a boundary instant → no gap, no overlap
      expect(batches[i].endMs).toBe(batches[i + 1].startMs);
      // and the inclusive `latest` of batch i is exactly 1µs before batch i+1's `oldest`
      expect(tsExclusiveBefore(batches[i].endMs) < epochMsToTs(batches[i + 1].startMs)).toBe(true);
    }
    return batches;
  }

  it("tiles a month into weeks with the final batch clipped to the end", () => {
    const w = resolveWindow({ from: "2026-05-01", to: "2026-06-07" }, NOW);
    const batches = assertTiling(w.oldestMs, w.endMs, 7 * 86_400_000);
    expect(batches.length).toBe(6); // 38 days (through 06-07) → 5×7d + a 3-day tail
    expect(formatDate(batches[0].startMs, w.tz)).toBe("2026-05-01");
    expect(formatDate(batches[batches.length - 1].endMs - 1, w.tz)).toBe("2026-06-07");
  });

  it("stays exact across a DST spring-forward week (coverage, not wall-clock)", () => {
    // US DST begins 2026-03-08. A weekly batching that spans it must still tile exactly.
    const w = resolveWindow({ from: "2026-03-01", to: "2026-03-21" }, NOW);
    assertTiling(w.oldestMs, w.endMs, 7 * 86_400_000);
  });
});
