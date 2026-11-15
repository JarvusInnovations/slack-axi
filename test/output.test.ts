import { describe, expect, it } from "vitest";
import {
  anyTruncated,
  FULL_HINT,
  renderList,
  TRUNCATION_MARK,
  truncate,
  wasTruncated,
} from "../src/output.js";

describe("renderList", () => {
  const rows = [
    { id: "C1", name: "#general" },
    { id: "C2", name: "#eng" },
  ];
  it("puts the total in a count: field and the row count in the array header", () => {
    expect(renderList("channels", rows, { total: 47 })).toBe(
      "count: 2 of 47\nchannels[2]{id,name}:\n  C1,#general\n  C2,#eng",
    );
  });
  it("prints count: even when nothing was cut", () => {
    expect(renderList("channels", rows, { total: 2 })).toMatch(/^count: 2 of 2\nchannels\[2\]/);
  });
  it("qualifies a filtered view", () => {
    expect(renderList("drafts", rows, { total: 46, qualifier: "pending" })).toMatch(
      /^count: 2 pending of 46\ndrafts\[2\]/,
    );
  });
  it("carries no count: for a list that is complete by construction", () => {
    expect(renderList("citations", rows)).toBe("citations[2]{id,name}:\n  C1,#general\n  C2,#eng");
  });
  it("never writes a total into the array header", () => {
    expect(renderList("channels", rows, { total: 47 })).not.toMatch(/\[\d+ of/);
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("cuts long prose and notes the total length", () => {
    const text = "a".repeat(600);
    const out = truncate(text, 500);
    expect(out.startsWith("a".repeat(499))).toBe(true);
    expect(out).toContain(`${TRUNCATION_MARK}600 chars total)`);
    expect(wasTruncated(out)).toBe(true);
  });

  it("never cuts inside a URL — extends the preview to the URL's end", () => {
    const url = "https://docs.google.com/document/d/14EUpOSYfwHl9kq2/edit?usp=sharing";
    const text = `${"x".repeat(480)} see ${url} and more words after it ${"y".repeat(100)}`;
    const out = truncate(text, 500);
    expect(out).toContain(url);
    expect(out.indexOf(TRUNCATION_MARK)).toBe(out.indexOf(url) + url.length);
  });

  it("returns the whole text when extending past a URL reaches the end", () => {
    const url = "https://example.com/a/very/long/path/that/runs/to/the/end";
    const text = `${"x".repeat(495)} ${url}`;
    expect(truncate(text, 500)).toBe(text);
    expect(wasTruncated(truncate(text, 500))).toBe(false);
  });

  it("cuts normally when the cut point is after a URL", () => {
    const text = `see https://example.com/x ${"z".repeat(600)}`;
    const out = truncate(text, 500);
    expect(out).toContain("https://example.com/x");
    expect(out.length).toBeLessThan(560);
    expect(wasTruncated(out)).toBe(true);
  });
});

describe("anyTruncated", () => {
  it("detects a truncated text cell among rows", () => {
    const rows = [{ text: "short" }, { text: truncate("b".repeat(700)) }];
    expect(anyTruncated(rows)).toBe(true);
    expect(anyTruncated([{ text: "short" }])).toBe(false);
    expect(FULL_HINT).toContain("--full");
  });
});
