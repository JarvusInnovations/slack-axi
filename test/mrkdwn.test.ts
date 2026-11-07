import { describe, expect, it } from "vitest";
import { protectSlackTokens, renderMrkdwn, restoreSlackTokens } from "../src/slack/mrkdwn.js";

// Strip the zero-width spaces slackify-markdown wraps emphasis in, so expectations stay readable.
const z = (s: string) => s.replace(/​/g, "");

describe("renderMrkdwn — the before/after table", () => {
  const table: Array<[string, string]> = [
    ["**bold** and __bold2__", "*bold* and *bold2*"],
    ["*em* and _em2_", "_em_ and _em2_"],
    ["~~gone~~", "~gone~"],
    ["# Heading\n\nbody", "*Heading*\n\nbody"],
    ["### Sub heading", "*Sub heading*"],
    ["- one\n- two\n  - nested", "•   one\n•   two\n    •   nested"],
    ["1. first\n2. second", "1.  first\n2.  second"],
    ["[text](https://x.y/a)", "<https://x.y/a|text>"],
    ["bare https://x.y/b here", "bare <https://x.y/b|https://x.y/b> here"],
    ["inline `code` stays", "inline `code` stays"],
    ["```js\nconst a = 1 < 2;\n```", "```\nconst a = 1 < 2;\n```"],
    ["> quoted\n> more", "> quoted\n> more"],
    ["fish & chips, 1 > 0", "fish &amp; chips, 1 &gt; 0"],
    ["para one\n\npara two", "para one\n\npara two"],
  ];
  for (const [md, expected] of table) {
    it(`${JSON.stringify(md)} → ${JSON.stringify(expected)}`, () => {
      expect(z(renderMrkdwn(md))).toBe(expected);
    });
  }

  it("has no trailing newline", () => {
    expect(renderMrkdwn("hello")).toBe("hello");
  });
});

describe("renderMrkdwn — Slack-native tokens pass through", () => {
  it("keeps mentions, channel refs, specials, and Slack links verbatim", () => {
    const md =
      "hey <@U024GAV5J> and <@U1|alice> in <#C0ANFD1AM5J|septa>: <!here> <!subteam^S123|@team> see <https://x.y/c|runbook> or <https://x.y/d>";
    expect(z(renderMrkdwn(md))).toBe(md);
  });
  it("renders Markdown around protected tokens", () => {
    expect(z(renderMrkdwn("**ping** <@U1> — [doc](https://d.oc/1)"))).toBe(
      "*ping* <@U1> — <https://d.oc/1|doc>",
    );
  });
  it("leaves hand-written • bullets alone", () => {
    expect(z(renderMrkdwn("• already a bullet\n• another"))).toBe("• already a bullet\n• another");
  });
  it("escapes a bare < in prose; an HTML-looking tag is passed through by the Markdown parser", () => {
    expect(z(renderMrkdwn("1 < 2 and <notatoken>"))).toBe("1 &lt; 2 and <notatoken>");
  });
});

describe("protect/restore round trip", () => {
  it("is lossless and indexes tokens in order", () => {
    const { text, tokens } = protectSlackTokens("a <@U1> b <https://x.y|l> c");
    expect(tokens).toEqual(["<@U1>", "<https://x.y|l>"]);
    expect(text).not.toContain("<");
    expect(restoreSlackTokens(text, tokens)).toBe("a <@U1> b <https://x.y|l> c");
  });
});
