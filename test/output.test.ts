import { describe, expect, it } from "vitest";
import { anyTruncated, FULL_HINT, TRUNCATION_MARK, truncate, wasTruncated } from "../src/output.js";

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
