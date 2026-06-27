import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeFlags } from "../src/flags.js";
import { paginate, toSearchDate } from "../src/commands/search.js";
import { resolveUserId } from "../src/slack/resolve.js";
import type { Session } from "../src/session.js";

describe("takeFlags (repeatable)", () => {
  it("collects every occurrence and leaves the rest", () => {
    const r = takeFlags(["--has", "link", "--has", "file", "--in", "#eng"], "--has");
    expect(r.values).toEqual(["link", "file"]);
    expect(r.rest).toEqual(["--in", "#eng"]);
  });
  it("returns empty values when absent", () => {
    const r = takeFlags(["--in", "#eng"], "--has");
    expect(r.values).toEqual([]);
    expect(r.rest).toEqual(["--in", "#eng"]);
  });
  it("ignores a trailing flag with no value", () => {
    const r = takeFlags(["--has"], "--has");
    expect(r.values).toEqual([]);
    expect(r.rest).toEqual(["--has"]);
  });
});

describe("toSearchDate", () => {
  const tz = "America/New_York";
  it("passes a YYYY-MM-DD date through", () => {
    expect(toSearchDate("2026-05-01", tz)).toBe("2026-05-01");
  });
  it("extracts the date from a datetime", () => {
    expect(toSearchDate("2026-05-01T14:30", tz)).toBe("2026-05-01");
  });
  it("normalizes a relative span to a YYYY-MM-DD date", () => {
    expect(toSearchDate("7d", tz)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("returns an unparseable token unchanged", () => {
    expect(toSearchDate("last-tuesday", tz)).toBe("last-tuesday");
  });
});

describe("paginate (page-based sweep)", () => {
  // A faked page source: `total` items spread across pages of `pageSize`.
  function pages(total: number, pageSize: number) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const calls: number[] = [];
    const fetchPage = async (page: number) => {
      calls.push(page);
      const start = (page - 1) * pageSize;
      const items = Array.from(
        { length: Math.max(0, Math.min(pageSize, total - start)) },
        (_, i) => start + i,
      );
      return { items, pages: pageCount, total };
    };
    return { fetchPage, calls };
  }

  it("sweeps every page to completion when under the cap", async () => {
    const { fetchPage, calls } = pages(250, 100);
    const res = await paginate(10_000, fetchPage);
    expect(res.items).toHaveLength(250);
    expect(res.total).toBe(250);
    expect(res.complete).toBe(true);
    expect(res.ceilingHit).toBe(false);
    expect(calls).toEqual([1, 2, 3]); // walked all three pages
  });

  it("stops at the cap and reports incomplete", async () => {
    const { fetchPage } = pages(250, 100);
    const res = await paginate(150, fetchPage);
    expect(res.items).toHaveLength(150);
    expect(res.total).toBe(250);
    expect(res.complete).toBe(false);
  });

  it("is complete when a single page covers the total", async () => {
    const { fetchPage, calls } = pages(7, 100);
    const res = await paginate(10_000, fetchPage);
    expect(res.items).toHaveLength(7);
    expect(res.complete).toBe(true);
    expect(calls).toEqual([1]);
  });

  it("reports complete for an empty result", async () => {
    const { fetchPage } = pages(0, 100);
    const res = await paginate(10_000, fetchPage);
    expect(res.items).toHaveLength(0);
    expect(res.total).toBe(0);
    expect(res.complete).toBe(true);
  });
});

describe("resolveUserId", () => {
  const TEAM = "T_TEST";
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slack-axi-test-"));
    process.env.SLACK_AXI_CONFIG_DIR = dir;
    const usersDir = join(dir, "cache", TEAM);
    mkdirSync(usersDir, { recursive: true });
    const users = {
      fetched_at: Date.now(),
      users: {
        U1: {
          id: "U1",
          name: "alice",
          real_name: "Alice Anderson",
          display_name: "alice",
          is_bot: false,
        },
        U2: { id: "U2", name: "bob", real_name: "Bob Brown", display_name: "bobby", is_bot: false },
        U3: {
          id: "U3",
          name: "alice2",
          real_name: "Alice Other",
          display_name: "alice",
          is_bot: false,
        },
      },
    };
    writeFileSync(join(usersDir, "users.json"), JSON.stringify(users));
  });

  afterEach(() => {
    delete process.env.SLACK_AXI_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const session = { teamId: TEAM } as Session;

  it("resolves a unique handle to its id", () => {
    expect(resolveUserId(session, "bob")).toEqual({ kind: "id", id: "U2" });
  });
  it("resolves by real name, case-insensitively, ignoring a leading @", () => {
    expect(resolveUserId(session, "@Bob Brown")).toEqual({ kind: "id", id: "U2" });
  });
  it("reports ambiguity when more than one user shares a display name", () => {
    const r = resolveUserId(session, "alice");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.ids.sort()).toEqual(["U1", "U3"]);
  });
  it("reports none when nothing matches", () => {
    expect(resolveUserId(session, "nobody")).toEqual({ kind: "none" });
  });
});
