import { describe, expect, it } from "vitest";
import { formatLink, formatText } from "../src/slack/format.js";

const GDOC = "https://docs.google.com/document/d/14EUpOSYfwHl9kq2vQ7/edit?usp=sharing";

describe("formatLink", () => {
  it("keeps both label and href for a real label", () => {
    expect(formatLink("https://x.y/a", "the doc")).toBe("the doc (https://x.y/a)");
  });

  it("renders the URL alone when the label is a display form of it", () => {
    expect(
      formatLink(GDOC, "docs.google.com/document/d/14EUpOSYfwHl9kq2vQ7/edit?usp=sharing"),
    ).toBe(GDOC);
    // Slack's shortened display label (prefix + ellipsis) — the exact case from #18.
    expect(formatLink(GDOC, "docs.google.com/document/d/14EUpOSYfwHl…")).toBe(GDOC);
    // …and the mid-label ellipsis form seen live (`prefix…/edit?usp=sharing`).
    expect(formatLink(GDOC, "docs.google.com/document/d/14EUpOSYfwHl…/edit?usp=sharing")).toBe(
      GDOC,
    );
    expect(formatLink(GDOC, "docs.google.com/document/d/14EUpOSYfwHl.../edit?usp=sharing")).toBe(
      GDOC,
    );
    // A label that merely resembles a URL but is a different one keeps both.
    expect(formatLink("https://x.y/a", "x.y/b")).toBe("x.y/b (https://x.y/a)");
    expect(formatLink("https://x.y/a", "https://x.y/a")).toBe("https://x.y/a");
    expect(formatLink("https://x.y/a", "  ")).toBe("https://x.y/a");
  });
});

describe("formatText links", () => {
  it("renders <url|label> with the href kept and <url> whole", () => {
    expect(formatText(`see <${GDOC}|Q3 budget> and <https://a.b/c>`, {})).toBe(
      `see Q3 budget (${GDOC}) and https://a.b/c`,
    );
  });

  it("does not duplicate a self-labeled pasted link", () => {
    expect(formatText(`<${GDOC}|docs.google.com/document/d/14EUpOSYfwHl…>`, {})).toBe(GDOC);
  });

  it("still resolves mentions, channels, and entities", () => {
    expect(formatText("<@U1|alice> in <#C1|eng> &amp; <https://a.b|a.b>", {})).toBe(
      "@alice in #eng & https://a.b",
    );
  });
});
