import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  audienceCommand,
  classifyMember,
  collectAudience,
  parseMaxMembers,
  renderAudience,
} from "../src/commands/audience.js";
import type { Session } from "../src/session.js";

// Every id here is invented. No real workspace, channel, person or bot.
const TEAM = "T0TEAM001";
const OTHER_TEAM = "T0OTHER01";
const SIBLING_TEAM = "T0SIBLNG1";
const ORG = "E0ORG0001";

/** A Slack error as @slack/web-api throws it (the response body rides on `data`). */
const slackError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`An API error occurred: ${code}`), {
    data: { ok: false, error: code, ...extra },
  });

type User = Record<string, unknown>;

const user = (id: string, name: string, extra: User = {}): User => ({
  id,
  name: name.toLowerCase().replace(/\s+/g, "."),
  team_id: TEAM,
  profile: { real_name: name, display_name: name.split(" ")[0] },
  ...extra,
});

interface FakeOpts {
  channel?: Record<string, unknown>;
  /** Member pages, in order; each becomes one conversations.members response. */
  pages?: string[][];
  users?: Record<string, User>;
  auth?: Record<string, unknown>;
  fail?: Partial<Record<"auth" | "info" | "members" | "users", (arg: string) => Error | undefined>>;
  token?: string;
}

interface Calls {
  info: number;
  members: Array<{ cursor?: string; limit?: number }>;
  users: string[];
}

function fakeSession(opts: FakeOpts): { session: Session; calls: Calls } {
  const calls: Calls = { info: 0, members: [], users: [] };
  const pages = opts.pages ?? [[]];
  const client = {
    auth: {
      test: async () => {
        const e = opts.fail?.auth?.("");
        if (e) throw e;
        return { ok: true, team_id: TEAM, user_id: "U0ME00001", ...opts.auth };
      },
    },
    conversations: {
      info: async (args: { channel: string; include_num_members?: boolean }) => {
        calls.info++;
        expect(args.include_num_members).toBe(true);
        const e = opts.fail?.info?.(args.channel);
        if (e) throw e;
        return { ok: true, channel: { id: args.channel, ...opts.channel } };
      },
      members: async (args: { channel: string; cursor?: string; limit?: number }) => {
        calls.members.push({ cursor: args.cursor, limit: args.limit });
        const e = opts.fail?.members?.(args.channel);
        if (e) throw e;
        const index = args.cursor ? Number(args.cursor.replace("page-", "")) : 0;
        const next = index + 1 < pages.length ? `page-${index + 1}` : "";
        return {
          ok: true,
          members: pages[index],
          response_metadata: { next_cursor: next },
        };
      },
    },
    users: {
      info: async (args: { user: string }) => {
        calls.users.push(args.user);
        const e = opts.fail?.users?.(args.user);
        if (e) throw e;
        const u = opts.users?.[args.user];
        if (!u) throw slackError("user_not_found");
        return { ok: true, user: u };
      },
    },
  };
  return {
    session: {
      token: opts.token ?? "xoxp-test-not-a-real-token",
      teamId: TEAM,
      teamName: "Example Co",
      client,
    } as unknown as Session,
    calls,
  };
}

async function run(opts: FakeOpts, channel = "C0CHAN001", maxMembers = 200, members = false) {
  const { session, calls } = fakeSession(opts);
  const report = await collectAudience(session, channel, { maxMembers });
  return { report, out: renderAudience(session, report, { members }), calls };
}

async function errorOf(p: Promise<unknown>): Promise<AxiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AxiError);
    return err as AxiError;
  }
  throw new Error("expected an error");
}

// Tests never touch the real config dir or a real token.
let dir: string;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slack-axi-audience-"));
  for (const k of ["SLACK_AXI_CONFIG_DIR", "SLACK_AXI_TOKEN", "SLACK_AXI_TEAM"])
    saved[k] = process.env[k];
  process.env.SLACK_AXI_CONFIG_DIR = dir;
  delete process.env.SLACK_AXI_TOKEN;
  delete process.env.SLACK_AXI_TEAM;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const plainChannel = {
  name: "proj-internal",
  is_channel: true,
  is_private: false,
  is_member: true,
  is_shared: false,
  is_ext_shared: false,
  is_org_shared: false,
  is_pending_ext_shared: false,
  num_members: 2,
};

describe("audience — plain internal channel", () => {
  it("reports the sharing flags and an all-full audience with a definitive empty list", async () => {
    const { report, out } = await run({
      channel: plainChannel,
      pages: [["U0AAAAAA1", "U0AAAAAA2"]],
      users: { U0AAAAAA1: user("U0AAAAAA1", "Ada One"), U0AAAAAA2: user("U0AAAAAA2", "Ben Two") },
    });
    expect(report.conversation).toMatchObject({
      id: "C0CHAN001",
      name: "#proj-internal",
      kind: "channel",
      is_member: true,
      is_shared: false,
      is_ext_shared: false,
      num_members: 2,
    });
    expect(report.truncated).toBe(false);
    expect(out).toContain("workspace: Example Co (T0TEAM001)");
    expect(out).toContain("members_checked: 2 of 2");
    expect(out).toContain("truncated: false");
    expect(out).toContain("full: 2");
    expect(out).toContain("external: 0");
    expect(out).toContain(
      "non_full_members: 0 (every checked member is a full member of this workspace)",
    );
    expect(out).not.toContain("help[");
  });
});

describe("audience — externally shared channel", () => {
  it("surfaces the shared flags and classifies the other organization's member as external", async () => {
    const { out, report } = await run({
      channel: {
        ...plainChannel,
        name: "proj-shared",
        is_shared: true,
        is_ext_shared: true,
        num_members: 3,
      },
      pages: [["U0AAAAAA1", "U0EXT0001", "U0BOT0001"]],
      users: {
        U0AAAAAA1: user("U0AAAAAA1", "Ada One"),
        U0EXT0001: user("U0EXT0001", "Pat Partner", { team_id: OTHER_TEAM }),
        U0BOT0001: user("U0BOT0001", "Build Bot", { is_bot: true }),
      },
    });
    expect(report.conversation.is_ext_shared).toBe(true);
    expect(out).toContain("is_shared: true");
    expect(out).toContain("is_ext_shared: true");
    expect(out).toContain("external: 1");
    expect(out).toContain("bots: 1");
    expect(out).toContain("non_full_members[2]{id,name,why}:");
    expect(out).toContain("U0EXT0001,Pat Partner,other organization (team T0OTHER01)");
    expect(out).toContain("U0BOT0001,Build Bot,bot");
    expect(out).toContain("Add `--members` to list every member with its flags");
  });

  it("reports a pending external share even before anyone from outside joins", async () => {
    const { out } = await run({
      channel: { ...plainChannel, is_pending_ext_shared: true, num_members: 1 },
      pages: [["U0AAAAAA1"]],
      users: { U0AAAAAA1: user("U0AAAAAA1", "Ada One") },
    });
    expect(out).toContain("is_pending_ext_shared: true");
  });
});

describe("audience — guests, strangers, other teams", () => {
  it("counts single- and multi-channel guests", async () => {
    const { out } = await run({
      channel: plainChannel,
      pages: [["U0AAAAAA1", "U0GUEST01", "U0GUEST02"]],
      users: {
        U0AAAAAA1: user("U0AAAAAA1", "Ada One"),
        U0GUEST01: user("U0GUEST01", "Gil Guest", { is_restricted: true }),
        U0GUEST02: user("U0GUEST02", "Sam Single", {
          is_restricted: true,
          is_ultra_restricted: true,
        }),
      },
    });
    expect(out).toContain("guests: 2");
    expect(out).toContain("U0GUEST01,Gil Guest,multi-channel guest");
    expect(out).toContain("U0GUEST02,Sam Single,single-channel guest");
  });

  it("treats a member from another team as external even when is_stranger is false", () => {
    const m = classifyMember(
      user("U0EXT0001", "Pat Partner", { team_id: OTHER_TEAM, is_stranger: false }),
      {
        teamId: TEAM,
      },
    );
    expect(m.category).toBe("external");
    expect(m.external).toBe(true);
  });

  it("treats is_stranger as external even with a matching team", () => {
    const m = classifyMember(user("U0STR0001", "Stan Ger", { is_stranger: true }), {
      teamId: TEAM,
    });
    expect(m).toMatchObject({ category: "external", why: "stranger" });
  });

  it("ranks external above guest and bot", () => {
    const m = classifyMember(
      user("U0EXT0002", "Gwen Guest", { team_id: OTHER_TEAM, is_restricted: true, is_bot: true }),
      { teamId: TEAM },
    );
    expect(m.category).toBe("external");
    expect(m.guest).toBe("multi");
    expect(m.bot).toBe(true);
  });

  it("calls a sibling workspace in the same Enterprise org other_workspace, not external", async () => {
    const sibling = user("U0SIB0001", "Sib Ling", {
      team_id: SIBLING_TEAM,
      enterprise_user: { enterprise_id: ORG, teams: [TEAM, SIBLING_TEAM] },
    });
    const { out } = await run({
      auth: { enterprise_id: ORG },
      channel: { ...plainChannel, is_shared: true, is_org_shared: true },
      pages: [["U0SIB0001"]],
      users: { U0SIB0001: sibling },
    });
    expect(out).toContain("is_org_shared: true");
    expect(out).toContain("external: 0");
    expect(out).toContain("other_workspace: 1");
    expect(out).toContain('U0SIB0001,Sib Ling,"same org, other workspace (team T0SIBLNG1)"');
    // Without an Enterprise org on the token, the same user is another organization.
    expect(classifyMember(sibling, { teamId: TEAM }).category).toBe("external");
  });

  it("counts deactivated accounts and unresolved ids separately, never as full", async () => {
    const { out } = await run({
      channel: plainChannel,
      pages: [["U0AAAAAA1", "U0GONE001", "U0HIDDEN1"]],
      users: {
        U0AAAAAA1: user("U0AAAAAA1", "Ada One"),
        U0GONE001: user("U0GONE001", "Old Account", { deleted: true }),
      },
      fail: {
        users: (id) => (id === "U0HIDDEN1" ? slackError("user_not_visible") : undefined),
      },
    });
    expect(out).toContain("full: 1");
    expect(out).toContain("deactivated: 1");
    expect(out).toContain("unresolved: 1");
    expect(out).toContain("U0HIDDEN1,U0HIDDEN1,unresolved (user_not_visible)");
    expect(out).toContain("U0GONE001,Old Account,deactivated");
  });
});

describe("audience — im and mpim", () => {
  it("reports an im with the other user and names it after them", async () => {
    const { report, out } = await run(
      {
        channel: { is_im: true, user: "U0OTHER01", is_shared: false },
        pages: [["U0ME00001", "U0OTHER01"]],
        users: {
          U0ME00001: user("U0ME00001", "Me Myself"),
          U0OTHER01: user("U0OTHER01", "Olive Other"),
        },
      },
      "D0DM00001",
    );
    expect(report.conversation).toMatchObject({
      kind: "im",
      user: "U0OTHER01",
      name: "@Olive Other",
    });
    expect(report.conversation.num_members).toBeUndefined();
    expect(out).toContain("kind: im");
    expect(out).toContain("user: U0OTHER01");
    expect(out).toContain("members_checked: 2 of 2");
  });

  it("names a group DM from its participants", async () => {
    const { report } = await run(
      {
        channel: { is_mpim: true, is_private: true, name: "mpdm-ada--ben--cal-1" },
        pages: [["U0AAAAAA1"]],
        users: { U0AAAAAA1: user("U0AAAAAA1", "Ada One") },
      },
      "G0MPIM001",
    );
    expect(report.conversation).toMatchObject({ kind: "mpim", name: "ada, ben, cal" });
  });
});

describe("audience — paging and the bound", () => {
  const ids = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `U0${prefix}${String(i).padStart(4, "0")}`);
  const everyone = (list: string[]) =>
    Object.fromEntries(list.map((id) => [id, user(id, `Person ${id}`)]));

  it("pages across cursors to completion", async () => {
    const pages = [ids("PA", 3), ids("PB", 3), ids("PC", 2)];
    const { report, out, calls } = await run({
      channel: { ...plainChannel, num_members: 8 },
      pages,
      users: everyone(pages.flat()),
    });
    expect(calls.members.map((c) => c.cursor)).toEqual([undefined, "page-1", "page-2"]);
    expect(calls.members.every((c) => c.limit === 200)).toBe(true);
    expect(report.checked).toBe(8);
    expect(out).toContain("members_checked: 8 of 8");
    expect(out).toContain("truncated: false");
  });

  it("stops at --max-members, says so, and does not look up the rest", async () => {
    const pages = [ids("PA", 3), ids("PB", 3), ids("PC", 3)];
    const { report, out, calls } = await run(
      { channel: { ...plainChannel, num_members: 9 }, pages, users: everyone(pages.flat()) },
      "C0CHAN001",
      4,
    );
    expect(calls.members).toHaveLength(2); // never fetched the third page
    expect(calls.users).toHaveLength(4);
    expect(report.truncated).toBe(true);
    expect(out).toContain("members_checked: 4 of 9");
    expect(out).toContain("truncated: true");
    expect(out).toContain("--max-members <n>");
  });

  it("says 'more than N' when truncated and Slack gave no member count", async () => {
    const pages = [ids("PA", 3), ids("PB", 3)];
    const { out } = await run(
      {
        channel: { ...plainChannel, num_members: undefined },
        pages,
        users: everyone(pages.flat()),
      },
      "C0CHAN001",
      3,
    );
    expect(out).toContain("members_checked: 3 of more than 3");
    expect(out).toContain("truncated: true");
  });

  it("is not truncated when the bound lands exactly on the last member", async () => {
    const pages = [ids("PA", 3)];
    const { out } = await run(
      { channel: { ...plainChannel, num_members: 3 }, pages, users: everyone(pages.flat()) },
      "C0CHAN001",
      3,
    );
    expect(out).toContain("members_checked: 3 of 3");
    expect(out).toContain("truncated: false");
  });

  it("--members lists every member with its flags, non-full first", async () => {
    const { out } = await run(
      {
        channel: plainChannel,
        pages: [["U0AAAAAA1", "U0GUEST01"]],
        users: {
          U0AAAAAA1: user("U0AAAAAA1", "Ada One"),
          U0GUEST01: user("U0GUEST01", "Gil Guest", { is_restricted: true }),
        },
      },
      "C0CHAN001",
      200,
      true,
    );
    expect(out).toContain("members[2]{id,name,category,team,guest,external,bot,deactivated}:");
    expect(out).toContain("U0GUEST01,Gil Guest,guest,T0TEAM001,multi,false,false,false");
    expect(out).toContain('U0AAAAAA1,Ada One,full,T0TEAM001,"",false,false,false');
    expect(out.indexOf("U0GUEST01")).toBeLessThan(out.indexOf("U0AAAAAA1"));
    expect(out).not.toContain("non_full_members");
  });
});

describe("audience — errors", () => {
  it("channel_not_found → CHANNEL_NOT_FOUND", async () => {
    const err = await errorOf(run({ fail: { info: () => slackError("channel_not_found") } }));
    expect(err.code).toBe("CHANNEL_NOT_FOUND");
    expect(err.message).toContain("not found");
  });

  it("no_permission on conversations.info → NOT_IN_CHANNEL", async () => {
    const err = await errorOf(run({ fail: { info: () => slackError("no_permission") } }));
    expect(err.code).toBe("NOT_IN_CHANNEL");
  });

  it("a known conversation whose members can't be listed → NOT_IN_CHANNEL, not not-found", async () => {
    const err = await errorOf(
      run({
        channel: { ...plainChannel, is_private: true },
        fail: { members: () => slackError("channel_not_found") },
      }),
    );
    expect(err.code).toBe("NOT_IN_CHANNEL");
    expect(err.suggestions.join(" ")).toContain("Join the conversation");
  });

  it("a bot token is told to invite the bot", async () => {
    const err = await errorOf(
      run({
        token: "xoxb-test-not-a-real-token",
        channel: plainChannel,
        fail: { members: () => slackError("not_in_channel") },
      }),
    );
    expect(err.code).toBe("NOT_IN_CHANNEL");
    expect(err.suggestions.join(" ")).toContain("Invite the bot");
  });

  it("missing_scope on conversations.info names Slack's needed scope", async () => {
    const err = await errorOf(
      run(
        { fail: { info: () => slackError("missing_scope", { needed: "groups:read" }) } },
        "G0PRIV001",
      ),
    );
    expect(err.code).toBe("SCOPE_MISSING");
    expect(err.message).toContain("`groups:read`");
    expect(err.suggestions[0]).toContain("User Token Scopes");
  });

  it("missing_scope on an im without `needed` falls back to im:read", async () => {
    const err = await errorOf(
      run({ fail: { info: () => slackError("missing_scope") } }, "D0DM00001"),
    );
    expect(err.message).toContain("`im:read`");
  });

  it("missing_scope on users.info names users:read, with the bot fix for a bot token", async () => {
    const err = await errorOf(
      run({
        auth: { bot_id: "B0BOT0001" },
        channel: plainChannel,
        pages: [["U0AAAAAA1"]],
        fail: { users: () => slackError("missing_scope") },
      }),
    );
    expect(err.code).toBe("SCOPE_MISSING");
    expect(err.message).toContain("`users:read`");
    expect(err.suggestions[0]).toContain("Bot Token Scopes");
  });

  it("an unexpected users.info failure fails the command instead of skipping the member", async () => {
    const err = await errorOf(
      run({
        channel: plainChannel,
        pages: [["U0AAAAAA1"]],
        fail: { users: () => slackError("internal_error") },
      }),
    );
    expect(err.code).toBe("SLACK_ERROR");
  });

  it("an invalid token → AUTH_INVALID", async () => {
    const err = await errorOf(run({ fail: { auth: () => slackError("invalid_auth") } }));
    expect(err.code).toBe("AUTH_INVALID");
  });
});

describe("audience — argument validation (before any Slack call)", () => {
  it("rejects an unknown flag and lists the valid ones", async () => {
    const err = await errorOf(audienceCommand(["C0CHAN001", "--member"]));
    expect(err.code).toBe("USAGE");
    expect(err.message).toContain("--member");
    expect(err.suggestions[0]).toContain("--members, --max-members <n>, --team <id>");
  });

  it("requires exactly one channel", async () => {
    expect((await errorOf(audienceCommand([]))).code).toBe("USAGE");
    expect((await errorOf(audienceCommand(["C0CHAN001", "C0CHAN002"]))).code).toBe("USAGE");
  });

  it("validates --max-members", async () => {
    expect(parseMaxMembers(undefined)).toBe(200);
    expect(parseMaxMembers("50")).toBe(50);
    for (const bad of ["0", "-3", "ten", "1.5"])
      expect(() => parseMaxMembers(bad)).toThrow(AxiError);
    expect((await errorOf(audienceCommand(["C0CHAN001", "--max-members"]))).code).toBe("USAGE");
  });

  it("--help returns the command help", async () => {
    const out = await audienceCommand(["--help"]);
    expect(out).toContain("usage: slack-axi audience <channel>");
    expect(out).toContain("--max-members <n>");
  });

  it("with valid args and no token, fails on auth rather than on usage", async () => {
    const err = await errorOf(audienceCommand(["C0CHAN001"]));
    expect(err.code).not.toBe("USAGE");
  });
});
