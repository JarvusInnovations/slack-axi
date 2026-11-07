import { describe, expect, it } from "vitest";
import { linksFromAttachments, summarizeLinks, toLinkMeta } from "../src/slack/links.js";
import { toMessage } from "../src/slack/threads.js";

const GDOC = "https://docs.google.com/document/d/14EUpOSYfwHl9kq2/edit";

describe("toLinkMeta", () => {
  it("picks title_link first and keeps the title + service", () => {
    const l = toLinkMeta({
      title: "Q3 budget",
      title_link: GDOC,
      from_url: `${GDOC}?usp=sharing`,
      service_name: "Google Docs",
    });
    expect(l).toEqual({ url: GDOC, title: "Q3 budget", service: "Google Docs" });
  });

  it("falls back to from_url, then original_url", () => {
    expect(toLinkMeta({ from_url: "https://a.b/c" })?.url).toBe("https://a.b/c");
    expect(toLinkMeta({ original_url: "https://a.b/d" })?.url).toBe("https://a.b/d");
  });

  it("returns undefined for a URL-less attachment (message share, legacy text)", () => {
    expect(
      toLinkMeta({ fallback: "[June 5th] alice: hi", is_share: true, text: "hi" }),
    ).toBeUndefined();
    expect(toLinkMeta({ image_url: "https://img/x.png" })).toBeUndefined();
  });
});

describe("linksFromAttachments", () => {
  it("drops URL-less entries and de-duplicates by URL", () => {
    const links = linksFromAttachments([
      { title: "Doc", title_link: GDOC },
      { title: "Doc again", from_url: GDOC },
      { fallback: "plain" },
      { title: "Repo", title_link: "https://github.com/x/y" },
    ]);
    expect(links.map((l) => l.url)).toEqual([GDOC, "https://github.com/x/y"]);
  });

  it("is empty for a missing or non-array field", () => {
    expect(linksFromAttachments(undefined)).toEqual([]);
    expect(linksFromAttachments("nope")).toEqual([]);
  });
});

describe("summarizeLinks", () => {
  it("renders `title <url>`, bare url without a title, `; `-joined", () => {
    expect(
      summarizeLinks([{ url: GDOC, title: "Q3 budget" }, { url: "https://github.com/x/y" }]),
    ).toBe(`Q3 budget <${GDOC}>; https://github.com/x/y`);
    expect(summarizeLinks([])).toBe("");
  });
});

describe("toMessage carries links", () => {
  it("maps attachments[] to links and omits the key when none qualify", () => {
    const withLinks = toMessage({
      ts: "1.000001",
      text: `<${GDOC}>`,
      attachments: [{ title: "Q3 budget", title_link: GDOC, service_name: "Google Docs" }],
    });
    expect(withLinks.links).toEqual([{ url: GDOC, title: "Q3 budget", service: "Google Docs" }]);
    const without = toMessage({ ts: "1.000002", text: "hi", attachments: [{ fallback: "x" }] });
    expect(without.links).toBeUndefined();
  });
});
