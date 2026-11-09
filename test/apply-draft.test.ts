import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDraft, selectDrafts } from "../src/commands/write.js";
import { type Draft, getDraft } from "../src/config.js";
import type { Session } from "../src/session.js";
import { pinAttachment } from "../src/slack/files.js";

/** A Slack error as @slack/web-api throws it. */
const slackError = (code: string) => Object.assign(new Error(code), { data: { error: code } });

interface Call {
  method: string;
  args: Record<string, unknown>;
}

/**
 * A fake Session whose client records every call. `fail` maps a method to a predicate: when it returns
 * an error code for a call's args, that call throws it. `shares` controls what files.info reports.
 */
function fakeSession(opts: {
  fail?: Record<string, (args: Record<string, unknown>) => string | undefined>;
  shares?: (fileId: string) => Record<string, unknown>;
}): { session: Session; calls: Call[] } {
  const calls: Call[] = [];
  let tsCounter = 0;
  let fileCounter = 0;
  const call =
    (method: string, result: (args: Record<string, unknown>) => unknown) =>
    async (args: Record<string, unknown>) => {
      calls.push({ method, args });
      const code = opts.fail?.[method]?.(args);
      if (code) throw slackError(code);
      return result(args);
    };
  const client = {
    chat: {
      postMessage: call("chat.postMessage", () => ({ ts: `1700000000.00000${++tsCounter}` })),
      update: call("chat.update", () => ({})),
      delete: call("chat.delete", () => ({})),
      getPermalink: call("chat.getPermalink", (a) => ({
        permalink: `https://x.slack.com/p${String(a.message_ts)}`,
      })),
    },
    files: {
      getUploadURLExternal: call("files.getUploadURLExternal", () => {
        fileCounter++;
        return { upload_url: `https://upload.test/${fileCounter}`, file_id: `F${fileCounter}` };
      }),
      completeUploadExternal: call("files.completeUploadExternal", () => ({})),
      info: call("files.info", (a) => ({
        file: { id: a.file, ...opts.shares?.(String(a.file)) },
      })),
      delete: call("files.delete", () => ({})),
    },
  };
  return { session: { token: "xoxp-test", teamId: "T1", client } as unknown as Session, calls };
}

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const sharedIn = (channel: string, ts: string) => ({ shares: { public: { [channel]: [{ ts }] } } });

function baseDraft(extra: Partial<Draft> = {}): Draft {
  return {
    id: "d_0000abcd",
    team: "T1",
    channel_id: "C1",
    channel: "#eng",
    text: "hello",
    created_at: new Date().toISOString(),
    ...extra,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slack-axi-apply-"));
  process.env.SLACK_AXI_CONFIG_DIR = dir;
  // Upload URLs are plain HTTP POSTs outside the Slack client.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("ok", { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SLACK_AXI_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("applyDraft — plain and chunked posts", () => {
  it("posts a human-mode draft as one text message and records it", async () => {
    const { session, calls } = fakeSession({});
    const out = await applyDraft(session, baseDraft());
    const posts = calls.filter((c) => c.method === "chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0].args).toMatchObject({ channel: "C1", text: "hello" });
    expect(posts[0].args.blocks).toBeUndefined();
    expect(out).toContain("sent: d_0000abcd");
    expect(getDraft("d_0000abcd")?.sent?.ts).toBe("1700000000.000001");
  });

  it("posts one message per bot-mode chunk: fallback text first, then (continued)", async () => {
    const { session, calls } = fakeSession({});
    const draft = baseDraft({ blocks: [[section("one")], [section("two")]], reply_to: "1.5" });
    const out = await applyDraft(session, draft);
    const posts = calls.filter((c) => c.method === "chat.postMessage");
    expect(posts.map((p) => p.args.text)).toEqual(["hello", "(continued)"]);
    expect(posts.every((p) => p.args.thread_ts === "1.5")).toBe(true);
    expect(getDraft(draft.id)?.sent?.chunks).toHaveLength(2);
    expect(out).toContain("messages: 2");
  });

  it("re-posts a chunk Slack rejects as invalid_blocks as the blocks' text", async () => {
    const { session, calls } = fakeSession({
      fail: { "chat.postMessage": (a) => (a.blocks ? "invalid_blocks" : undefined) },
    });
    await applyDraft(session, baseDraft({ blocks: [[section("alpha"), section("beta")]] }));
    const posts = calls.filter((c) => c.method === "chat.postMessage");
    expect(posts).toHaveLength(2);
    expect(posts[1].args).toEqual({ channel: "C1", text: "alpha\n\nbeta" });
  });

  it("surfaces any other Slack error as a translated AxiError and records nothing", async () => {
    const { session } = fakeSession({ fail: { "chat.postMessage": () => "channel_not_found" } });
    await expect(applyDraft(session, baseDraft())).rejects.toMatchObject({
      code: "CHANNEL_NOT_FOUND",
    });
    expect(getDraft("d_0000abcd")).toBeUndefined();
  });
});

describe("applyDraft — edits and idempotency", () => {
  it("edits with chat.update, clearing blocks in human mode, and confirms the new first line", async () => {
    const { session, calls } = fakeSession({});
    const draft = baseDraft({
      kind: "edit",
      target_ts: "1700000000.000009",
      markdown: "\nfixed **wording**\nmore",
      text: "fixed *wording*\nmore",
    });
    const out = await applyDraft(session, draft);
    const updates = calls.filter((c) => c.method === "chat.update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args).toEqual({
      channel: "C1",
      ts: "1700000000.000009",
      text: "fixed *wording*\nmore",
      blocks: [],
    });
    expect(calls.some((c) => c.method === "chat.postMessage")).toBe(false);
    expect(out).toContain("applied: d_0000abcd");
    expect(out).toContain("text: fixed **wording**");
    expect(getDraft(draft.id)?.sent?.ts).toBe("1700000000.000009");
  });

  it("sends a bot-mode edit's single chunk as the blocks", async () => {
    const { session, calls } = fakeSession({});
    await applyDraft(
      session,
      baseDraft({ kind: "edit", target_ts: "1.2", blocks: [[section("new")]] }),
    );
    expect(calls.find((c) => c.method === "chat.update")?.args.blocks).toEqual([section("new")]);
  });

  it("maps edit_window_closed and records nothing", async () => {
    const { session } = fakeSession({ fail: { "chat.update": () => "edit_window_closed" } });
    await expect(
      applyDraft(session, baseDraft({ kind: "edit", target_ts: "1.2" })),
    ).rejects.toMatchObject({ code: "EDIT_WINDOW_CLOSED" });
    expect(getDraft("d_0000abcd")).toBeUndefined();
  });

  it("is a no-op for an already-sent draft: no client calls", async () => {
    const { session, calls } = fakeSession({});
    const sent = baseDraft({ sent: { ts: "1.2", permalink: "https://x/p12", at: "t" } });
    const out = await applyDraft(session, sent);
    expect(calls).toHaveLength(0);
    expect(out).toContain("already sent (no-op)");
  });
});

describe("applyDraft — attachments", () => {
  function pinned(name: string, body: string, kind: "file" | "snippet" = "file") {
    const path = join(dir, name);
    writeFileSync(path, body);
    return pinAttachment(path, kind);
  }

  it("human mode: uploads, then shares with the text as initial_comment, and finds the ts", async () => {
    const { session, calls } = fakeSession({ shares: () => sharedIn("C1", "1700000000.000099") });
    const draft = baseDraft({ attachments: [pinned("q.sql", "select 1;\n", "snippet")] });
    const out = await applyDraft(session, draft, { shareTimeoutMs: 50 });
    const upload = calls.find((c) => c.method === "files.getUploadURLExternal");
    expect(upload?.args).toMatchObject({ filename: "q.sql", snippet_type: "sql" });
    const share = calls.find((c) => c.method === "files.completeUploadExternal");
    expect(share?.args).toMatchObject({ channel_id: "C1", initial_comment: "hello" });
    expect(share?.args.blocks).toBeUndefined();
    expect(calls.some((c) => c.method === "chat.postMessage")).toBe(false);
    const sent = getDraft(draft.id)?.sent;
    expect(sent).toMatchObject({ ts: "1700000000.000099", files: ["F1"] });
    expect(out).toContain("files: F1");
  });

  it("bot mode: shares with the first chunk's blocks, falls back to its text on invalid_blocks", async () => {
    const { session, calls } = fakeSession({
      fail: { "files.completeUploadExternal": (a) => (a.blocks ? "invalid_blocks" : undefined) },
      shares: () => sharedIn("C1", "1700000000.000042"),
    });
    const draft = baseDraft({
      blocks: [[section("with the file")], [section("second chunk")]],
      attachments: [pinned("a.png", "\x89PNG")],
    });
    await applyDraft(session, draft, { shareTimeoutMs: 50 });
    const shares = calls.filter((c) => c.method === "files.completeUploadExternal");
    expect(shares).toHaveLength(2);
    expect(shares[0].args.blocks).toEqual([section("with the file")]);
    expect(shares[1].args).toMatchObject({ initial_comment: "with the file" });
    // The remaining chunk still posts as its own message.
    const posts = calls.filter((c) => c.method === "chat.postMessage");
    expect(posts.map((p) => p.args.text)).toEqual(["(continued)"]);
    expect(getDraft(draft.id)?.sent?.chunks?.[0]).toBe("1700000000.000042");
  });

  it("reports ts: pending when Slack hasn't reported the share within the poll bound", async () => {
    const { session } = fakeSession({ shares: () => ({}) });
    const draft = baseDraft({ attachments: [pinned("n.txt", "note")] });
    const out = await applyDraft(session, draft, { shareTimeoutMs: 20 });
    expect(out).toContain("ts: pending");
    expect(out).toContain("look it up again");
    expect(getDraft(draft.id)?.sent).toMatchObject({ ts: "", files: ["F1"] });
  });

  it("refuses with ATTACHMENT_CHANGED before any upload when a pinned file changed", async () => {
    const { session, calls } = fakeSession({});
    const att = pinned("r.txt", "reviewed");
    writeFileSync(att.path, "edited after review");
    await expect(applyDraft(session, baseDraft({ attachments: [att] }))).rejects.toMatchObject({
      code: "ATTACHMENT_CHANGED",
    });
    expect(calls).toHaveLength(0);
  });

  it("maps a missing files:write scope to SCOPE_MISSING naming it, and posts nothing", async () => {
    const { session, calls } = fakeSession({
      fail: { "files.getUploadURLExternal": () => "missing_scope" },
    });
    const err = await applyDraft(session, baseDraft({ attachments: [pinned("s.txt", "x")] })).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ code: "SCOPE_MISSING" });
    expect(String(err.message)).toContain("files:write");
    expect(calls.some((c) => c.method === "chat.postMessage")).toBe(false);
  });
});

describe("applyDraft — delete with files", () => {
  it("deletes the message and the draft's uploaded files, tolerating already-gone files", async () => {
    const { session, calls } = fakeSession({
      fail: { "files.delete": (a) => (a.file === "F2" ? "file_not_found" : undefined) },
    });
    const draft = baseDraft({ kind: "delete", target_ts: "1.000001", target_files: ["F1", "F2"] });
    const out = await applyDraft(session, draft);
    expect(calls.filter((c) => c.method === "chat.delete")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "files.delete").map((c) => c.args.file)).toEqual([
      "F1",
      "F2",
    ]);
    expect(out).toContain("files_deleted: 1");
  });
});

describe("selectDrafts (draft list)", () => {
  const sent = { ts: "1.2", permalink: "", at: "" };
  const drafts = [{ id: "a" }, { id: "b", sent }, { id: "c" }, { id: "d", sent }];
  it("shows pending drafts by default and reports both counts", () => {
    const r = selectDrafts(drafts, false);
    expect(r.shown.map((d) => d.id)).toEqual(["a", "c"]);
    expect(r).toMatchObject({ pending: 2, total: 4 });
  });
  it("shows every draft with --all", () => {
    expect(selectDrafts(drafts, true).shown).toHaveLength(4);
  });
});
