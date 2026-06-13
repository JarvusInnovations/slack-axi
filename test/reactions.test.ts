import { describe, expect, it } from "vitest";
import { orderReactions, summarizeReactions, toReactionCount } from "../src/slack/reactions.js";

describe("summarizeReactions", () => {
  it("renders :name:×count, space-joined, in input order", () => {
    expect(
      summarizeReactions([
        { name: "heart", count: 12 },
        { name: "eyes", count: 3 },
      ]),
    ).toBe(":heart:×12 :eyes:×3");
  });

  it("returns empty string for no reactions", () => {
    expect(summarizeReactions([])).toBe("");
  });

  it("preserves skin-tone / modifier suffixes verbatim", () => {
    expect(summarizeReactions([{ name: "+1::skin-tone-3", count: 2 }])).toBe(":+1::skin-tone-3:×2");
  });
});

describe("orderReactions", () => {
  it("sorts by count descending", () => {
    const ordered = orderReactions([
      { name: "a", count: 1 },
      { name: "b", count: 9 },
      { name: "c", count: 4 },
    ]);
    expect(ordered.map((r) => r.name)).toEqual(["b", "c", "a"]);
  });

  it("keeps native order for ties (stable)", () => {
    const ordered = orderReactions([
      { name: "first", count: 3 },
      { name: "second", count: 3 },
      { name: "third", count: 5 },
    ]);
    expect(ordered.map((r) => r.name)).toEqual(["third", "first", "second"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { name: "a", count: 1 },
      { name: "b", count: 2 },
    ];
    orderReactions(input);
    expect(input.map((r) => r.name)).toEqual(["a", "b"]);
  });
});

describe("toReactionCount", () => {
  it("drops the (truncated) embedded users list, keeping name + count", () => {
    expect(toReactionCount({ name: "tada", count: 14, users: ["U1", "U2"] })).toEqual({
      name: "tada",
      count: 14,
    });
  });

  it("defaults missing fields", () => {
    expect(toReactionCount({})).toEqual({ name: "", count: 0 });
  });
});
