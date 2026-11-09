import { describe, expect, it } from "vitest";
import { FILE_LINE_CAP, fileCommand, renderFileBlock } from "../src/commands/file.js";

const snippet = {
  id: "F1",
  name: "q.sql",
  filetype: "sql",
  mode: "snippet",
  size: 2048,
  permalink: "https://x.slack.com/files/U1/F1/q.sql",
};

describe("renderFileBlock", () => {
  it("prints a snippet's text indented under content, with shown/total", () => {
    const { block, clipped } = renderFileBlock(snippet, "SELECT id\n  FROM stops\n", false);
    expect(clipped).toBe(false);
    expect(block).toContain("snippet: true");
    expect(block).toContain("shown: 2 of 2 lines");
    expect(block).toContain("lines: 2");
    expect(block.endsWith("content: |\n  SELECT id\n    FROM stops")).toBe(true);
  });

  it("cuts at the cap unless full, and says so", () => {
    const text = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join("\n");
    const cut = renderFileBlock(snippet, text, false);
    expect(cut.clipped).toBe(true);
    expect(cut.block).toContain(`${FILE_LINE_CAP} of 250 lines`);
    expect(cut.block).toContain(`  line ${FILE_LINE_CAP}`);
    expect(cut.block).not.toContain(`line ${FILE_LINE_CAP + 1}`);
    const all = renderFileBlock(snippet, text, true);
    expect(all.clipped).toBe(false);
    expect(all.block).toContain("  line 250");
  });

  it("shows metadata only for a binary file", () => {
    const { block } = renderFileBlock(
      { id: "F2", name: "a.png", filetype: "png", size: 10 },
      undefined,
      false,
    );
    expect(block).toContain("content: (binary — use download)");
    expect(block).not.toContain("snippet");
    expect(block).not.toContain("shown");
  });
});

describe("fileCommand", () => {
  it("requires at least one file id", async () => {
    await expect(fileCommand([])).rejects.toMatchObject({ code: "USAGE" });
  });
  it("--help mentions download for binaries", async () => {
    expect(await fileCommand(["--help"])).toContain("download");
  });
});
