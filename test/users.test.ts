import { describe, expect, it } from "vitest";
import { toUserMeta, type UserMeta } from "../src/slack/cache.js";
import { mentionedUserIds, unresolvedLabel, userName } from "../src/slack/format.js";
import { collectUserIds } from "../src/commands/read.js";
import type { Msg } from "../src/slack/threads.js";

const TEAM = "T024GATE8";

describe("toUserMeta identity flags", () => {
  it("flags a Slack Connect member (different team_id) as external", () => {
    const u = toUserMeta(
      { id: "U01FMB233RS", name: "ryan.mahoney", team_id: "T01F0DWNU7R", profile: { display_name: "Ryan" } },
      TEAM,
    );
    expect(u.is_external).toBe(true);
    expect(u.is_guest).toBeUndefined();
    expect(u.display_name).toBe("Ryan");
  });

  it("flags is_stranger as external even when team_id matches", () => {
    const u = toUserMeta({ id: "U1", name: "x", team_id: TEAM, is_stranger: true }, TEAM);
    expect(u.is_external).toBe(true);
  });

  it("does not flag a same-workspace member as external", () => {
    const u = toUserMeta({ id: "U024GAV5J", name: "chris", team_id: TEAM, is_admin: true }, TEAM);
    expect(u.is_external).toBeUndefined();
  });

  it("flags restricted / ultra-restricted accounts as guests", () => {
    expect(toUserMeta({ id: "U2", name: "g", team_id: TEAM, is_restricted: true }, TEAM).is_guest).toBe(true);
    expect(toUserMeta({ id: "U3", name: "g", team_id: TEAM, is_ultra_restricted: true }, TEAM).is_guest).toBe(true);
  });

  it("carries is_bot, email, and title through when present", () => {
    const u = toUserMeta(
      { id: "B1", name: "bot", team_id: TEAM, is_bot: true, profile: { email: "a@b.co", title: "CEO" } },
      TEAM,
    );
    expect(u.is_bot).toBe(true);
    expect(u.email).toBe("a@b.co");
    expect(u.title).toBe("CEO");
  });
});

describe("userName / unresolvedLabel", () => {
  const users: Record<string, UserMeta> = { U1: { id: "U1", name: "ryan", display_name: "Ryan", is_bot: false } };

  it("prefers display name when resolved", () => {
    expect(userName("U1", users)).toBe("Ryan");
  });

  it("renders a missing id unambiguously, never as a bare id", () => {
    expect(userName("U404", users)).toBe("U404 (unresolved)");
    expect(unresolvedLabel("U404")).toBe("U404 (unresolved)");
  });
});

describe("mentionedUserIds", () => {
  it("extracts ids from both plain and piped mention markup", () => {
    expect(mentionedUserIds("hey <@U01ABC> and <@U02DEF|kristin> here")).toEqual(["U01ABC", "U02DEF"]);
  });

  it("returns nothing when there are no mentions", () => {
    expect(mentionedUserIds("no mentions, just <#C123|general>")).toEqual([]);
  });
});

describe("collectUserIds", () => {
  it("unions message authors with in-text mention ids, deduped", () => {
    const msgs: Msg[] = [
      { ts: "1", user: "U1", text: "ping <@U2>", replyCount: 0 },
      { ts: "2", user: "U2", text: "re <@U1> <@U3>", replyCount: 0 },
      { ts: "3", botId: "B1", text: "system note", replyCount: 0 },
    ];
    expect([...collectUserIds(msgs)].sort()).toEqual(["U1", "U2", "U3"]);
  });
});
