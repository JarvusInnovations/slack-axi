import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteCommand,
  draftKind,
  draftStatus,
  editCommand,
  firstLine,
  isOwnMessage,
} from "../src/commands/write.js";
import { writeDraft } from "../src/config.js";
import type { Session } from "../src/session.js";
import { fetchMessage } from "../src/slack/threads.js";

describe("isOwnMessage", () => {
  it("matches the identity's user id (user token)", () => {
    expect(isOwnMessage({ user: "U1" }, { userId: "U1" })).toBe(true);
    expect(isOwnMessage({ user: "U2" }, { userId: "U1" })).toBe(false);
  });
  it("matches the identity's bot id (bot token)", () => {
    expect(isOwnMessage({ user: "UB", botId: "B9" }, { userId: "UB", botId: "B9" })).toBe(true);
    expect(isOwnMessage({ botId: "B9" }, { userId: "U1", botId: "B9" })).toBe(true);
    expect(isOwnMessage({ botId: "B8" }, { userId: "U1", botId: "B9" })).toBe(false);
  });
  it("never matches with no identity, even for an authorless message", () => {
    expect(isOwnMessage({}, {})).toBe(false);
    expect(isOwnMessage({ user: "U1" }, {})).toBe(false);
  });
});

describe("draft kinds + status", () => {
  it("treats a record without kind as a post", () => {
    expect(draftKind({})).toBe("post");
    expect(draftKind({ kind: "edit" })).toBe("edit");
  });
  it("labels pending/applied by kind", () => {
    expect(draftStatus({})).toBe("pending");
    expect(draftStatus({ reply_to: "1.2" })).toBe("reply (pending)");
    expect(draftStatus({ kind: "edit" })).toBe("edit (pending)");
    expect(draftStatus({ kind: "delete" })).toBe("delete (pending)");
    const sent = { ts: "1.2", permalink: "", at: "" };
    expect(draftStatus({ sent })).toBe("sent");
    expect(draftStatus({ kind: "edit", sent })).toBe("edit applied");
  });
  it("firstLine skips leading blank lines", () => {
    expect(firstLine("\n\n  hello\nworld")).toBe("hello");
    expect(firstLine("")).toBe("");
  });
});

describe("edit/delete validation happens before any network call", () => {
  let dir: string;
  let savedToken: string | undefined;
  let savedTeam: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slack-axi-write-"));
    process.env.SLACK_AXI_CONFIG_DIR = dir;
    savedToken = process.env.SLACK_AXI_TOKEN;
    savedTeam = process.env.SLACK_AXI_TEAM;
    delete process.env.SLACK_AXI_TOKEN;
    delete process.env.SLACK_AXI_TEAM;
  });
  afterEach(() => {
    delete process.env.SLACK_AXI_CONFIG_DIR;
    if (savedToken === undefined) delete process.env.SLACK_AXI_TOKEN;
    else process.env.SLACK_AXI_TOKEN = savedToken;
    if (savedTeam === undefined) delete process.env.SLACK_AXI_TEAM;
    else process.env.SLACK_AXI_TEAM = savedTeam;
    rmSync(dir, { recursive: true, force: true });
  });

  it("edit requires channel + ts + text", async () => {
    await expect(editCommand([])).rejects.toMatchObject({ code: "USAGE" });
    await expect(editCommand(["#eng"])).rejects.toMatchObject({ code: "USAGE" });
    await expect(editCommand(["#eng", "1717589640123456"])).rejects.toMatchObject({
      code: "USAGE",
    });
  });
  it("delete requires channel + ts", async () => {
    await expect(deleteCommand([])).rejects.toMatchObject({ code: "USAGE" });
    await expect(deleteCommand(["#eng"])).rejects.toMatchObject({ code: "USAGE" });
  });
  it("a complete invocation clears validation and stops at auth (NO_TOKEN)", async () => {
    await expect(editCommand(["#eng", "1717589640123456", "new"])).rejects.toMatchObject({
      code: "NO_TOKEN",
    });
    await expect(deleteCommand(["#eng", "1717589640123456"])).rejects.toMatchObject({
      code: "NO_TOKEN",
    });
  });
  it("an unknown draft id is rejected before auth", async () => {
    await expect(editCommand(["d_00000000", "new"])).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    });
  });
  it("a pending (unsent) draft id has no message to target", async () => {
    writeDraft({
      id: "d_0badcafe",
      team: "T1",
      channel_id: "C1",
      channel: "#eng",
      text: "hi",
      created_at: new Date().toISOString(),
    });
    await expect(deleteCommand(["d_0badcafe"])).rejects.toMatchObject({ code: "DRAFT_NOT_SENT" });
  });
  it("--help documents the ownership rule", async () => {
    expect(await editCommand(["--help"])).toContain("OWN messages");
    expect(await deleteCommand(["--help"])).toContain("OWN messages");
  });
});

describe("fetchMessage", () => {
  function fakeSession(history: unknown[], replies: unknown[] | Error): Session {
    const client = {
      conversations: {
        history: async () => ({ messages: history }),
        replies: async () => {
          if (replies instanceof Error) throw replies;
          return { messages: replies };
        },
      },
    };
    return { client } as unknown as Session;
  }

  it("returns a top-level message from history", async () => {
    const s = fakeSession([{ ts: "1.000001", user: "U1", text: "hi" }], []);
    expect((await fetchMessage(s, "C1", "1.000001"))?.text).toBe("hi");
  });
  it("falls through to replies for a thread reply", async () => {
    const s = fakeSession(
      [],
      [{ ts: "1.000002", user: "U1", text: "reply", thread_ts: "1.000001" }],
    );
    const m = await fetchMessage(s, "C1", "1.000002");
    expect(m?.text).toBe("reply");
    expect(m?.threadTs).toBe("1.000001");
  });
  it("ignores a neighbouring message that isn't the exact ts", async () => {
    const s = fakeSession([{ ts: "1.000009", user: "U1", text: "other" }], []);
    expect(await fetchMessage(s, "C1", "1.000001")).toBeUndefined();
  });
  it("treats thread_not_found from replies as a miss, not an error", async () => {
    const err = Object.assign(new Error("thread_not_found"), {
      data: { error: "thread_not_found" },
    });
    const s = fakeSession([], err);
    expect(await fetchMessage(s, "C1", "1.000001")).toBeUndefined();
  });
});
