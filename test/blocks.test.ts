import { describe, expect, it } from "vitest";
import type { KnownBlock } from "@slack/web-api";
import {
  blocksText,
  chunkBlocks,
  fallbackTextFor,
  renderBlocks,
  summarizeBlocks,
} from "../src/slack/blocks.js";

const section = (t: string): KnownBlock => ({ type: "section", text: { type: "mrkdwn", text: t } });
const table = (): KnownBlock => ({ type: "table", rows: [] }) as unknown as KnownBlock;

describe("chunkBlocks (claude-assist rules)", () => {
  it("keeps ≤50 blocks per chunk", () => {
    const chunks = chunkBlocks(Array.from({ length: 120 }, (_, i) => section(`s${i}`)));
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  });
  it("allows one table per chunk and flushes right after it", () => {
    const chunks = chunkBlocks([section("a"), table(), section("b"), table(), section("c")]);
    expect(chunks.map((c) => c.map((b) => b.type))).toEqual([
      ["section", "table"],
      ["section", "table"],
      ["section"],
    ]);
  });
  it("returns no chunks for no blocks", () => {
    expect(chunkBlocks([])).toEqual([]);
  });
});

describe("blocksText + summary + fallback", () => {
  it("joins the blocks' text fields for the invalid_blocks fallback", () => {
    expect(blocksText([section("one"), table(), section("two")])).toBe("one\n\ntwo");
  });
  it("summarizes block counts and types per chunk", () => {
    expect(summarizeBlocks([[section("a"), table()], [section("b")]])).toEqual({
      blocks: "3 in 2 chunk(s)",
      chunks: ["1: section, table", "2: section"],
    });
  });
  it("caps the fallback at 3000 chars", () => {
    expect(fallbackTextFor("x".repeat(4000))).toHaveLength(3000);
  });
});

describe("renderBlocks", () => {
  it("renders Markdown to blocks and keeps Slack-native tokens intact", async () => {
    const md =
      "# Status\n\nDeploy is **green** for <@U024GAV5J> in <#C1|eng> — <https://x.y/c|runbook>\n\n- api\n- web";
    const r = await renderBlocks(md);
    expect(r.chunks).toHaveLength(1);
    const types = r.chunks[0].map((b) => b.type);
    expect(types[0]).toBe("header");
    const json = JSON.stringify(r.chunks);
    expect(json).toContain("<@U024GAV5J>");
    expect(json).toContain("<#C1|eng>");
    expect(json).toContain("<https://x.y/c|runbook>");
    expect(json).not.toContain("&lt;@");
    expect(r.fallbackText).toBe(md);
  });
});
