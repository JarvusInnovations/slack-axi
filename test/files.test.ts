import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clipLines,
  describeAttachment,
  formatSize,
  isTextFile,
  pinAttachment,
  readPinnedAttachment,
  shareTs,
  snippetType,
  summarizeFiles,
  toFileMeta,
} from "../src/slack/files.js";

describe("formatSize", () => {
  it("renders B / KB / MB by magnitude", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(161608)).toBe("158KB");
    expect(formatSize(94101)).toBe("92KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0MB");
  });

  it("returns empty string for missing/invalid sizes", () => {
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(-1)).toBe("");
  });
});

describe("toFileMeta", () => {
  it("normalizes a standard file, pulling name/type/size", () => {
    const f = toFileMeta({
      id: "F0B8Q0DCAA3",
      name: "IMG_2731.jpg",
      title: "IMG_2731",
      mimetype: "image/jpeg",
      filetype: "jpg",
      size: 161608,
      permalink: "https://x.slack.com/files/...",
    });
    expect(f).toMatchObject({
      id: "F0B8Q0DCAA3",
      name: "IMG_2731.jpg",
      filetype: "jpg",
      size: 161608,
    });
    expect(f.unavailable).toBeUndefined();
  });

  it("flags a tombstoned file as unavailable", () => {
    expect(toFileMeta({ id: "F1", mode: "tombstone" }).unavailable).toBe(true);
  });

  it("flags an access-denied file as unavailable", () => {
    expect(
      toFileMeta({ id: "F2", name: "secret.pdf", file_access: "access_denied" }).unavailable,
    ).toBe(true);
  });

  it("falls back to the id when no name/title is present", () => {
    expect(toFileMeta({ id: "F3" }).name).toBe("F3");
  });
});

describe("summarizeFiles", () => {
  it("renders name (type, size) [id], semicolon-joined", () => {
    expect(
      summarizeFiles([
        { id: "F0B8Q0DCAA3", name: "IMG_2731.jpg", filetype: "jpg", size: 161608 },
        { id: "F0B9ZNJ1EBS", name: "IMG_2732.jpg", filetype: "jpg", size: 94101 },
      ]),
    ).toBe("IMG_2731.jpg (jpg, 158KB) [F0B8Q0DCAA3]; IMG_2732.jpg (jpg, 92KB) [F0B9ZNJ1EBS]");
  });

  it("marks unavailable files but still exposes the id", () => {
    expect(summarizeFiles([{ id: "F1", name: "x", unavailable: true }])).toBe("(unavailable) [F1]");
  });

  it("omits the parenthetical when no type/size is known", () => {
    expect(summarizeFiles([{ id: "F4", name: "note.txt" }])).toBe("note.txt [F4]");
  });

  it("returns empty string for no files", () => {
    expect(summarizeFiles([])).toBe("");
  });
});

describe("snippets in the files column", () => {
  it("toFileMeta carries snippet mode and line count", () => {
    const f = toFileMeta({ id: "F1", name: "q.sql", filetype: "sql", mode: "snippet", lines: 42 });
    expect(f).toMatchObject({ snippet: true, lines: 42 });
    expect(toFileMeta({ id: "F2", name: "a.png", mode: "hosted" }).snippet).toBeUndefined();
  });

  it("summarizeFiles marks a snippet with its syntax type and lines", () => {
    expect(
      summarizeFiles([
        { id: "F1", name: "q.sql", filetype: "sql", snippet: true, lines: 42 },
        { id: "F2", name: "one.txt", filetype: "text", snippet: true, lines: 1 },
        { id: "F3", name: "x.py", filetype: "python", snippet: true },
      ]),
    ).toBe(
      "q.sql (snippet: sql, 42 lines) [F1]; one.txt (snippet: text, 1 line) [F2]; x.py (snippet: python) [F3]",
    );
  });
});

describe("isTextFile", () => {
  it("treats snippets, text/*, and known text mimetypes as text", () => {
    expect(isTextFile({ mode: "snippet", mimetype: "application/octet-stream" })).toBe(true);
    expect(isTextFile({ mimetype: "text/plain" })).toBe(true);
    expect(isTextFile({ mimetype: "text/csv; charset=utf-8" })).toBe(true);
    expect(isTextFile({ mimetype: "application/json" })).toBe(true);
    expect(isTextFile({ mimetype: "image/png" })).toBe(false);
    expect(isTextFile({ mimetype: "application/pdf" })).toBe(false);
    expect(isTextFile({})).toBe(false);
  });
});

describe("snippetType", () => {
  it("maps extensions, Dockerfile, and falls back to text", () => {
    expect(snippetType("/tmp/q.sql")).toBe("sql");
    expect(snippetType("a/b/Script.PY")).toBe("python");
    expect(snippetType("x.yml")).toBe("yaml");
    expect(snippetType("Dockerfile")).toBe("dockerfile");
    expect(snippetType("notes.weird")).toBe("text");
    expect(snippetType("Makefile")).toBe("text");
  });
});

describe("clipLines", () => {
  it("counts lines, ignoring one trailing newline", () => {
    expect(clipLines("a\nb\nc\n")).toEqual({ text: "a\nb\nc", shown: 3, total: 3 });
    expect(clipLines("")).toEqual({ text: "", shown: 0, total: 0 });
  });
  it("cuts at max and reports shown vs total", () => {
    expect(clipLines("1\n2\n3\n4", 2)).toEqual({ text: "1\n2", shown: 2, total: 4 });
  });
});

describe("shareTs", () => {
  it("finds the share in the channel under public or private", () => {
    expect(shareTs({ shares: { public: { C1: [{ ts: "1.2" }] } } }, "C1")).toBe("1.2");
    expect(shareTs({ shares: { private: { D1: [{ ts: "3.4" }] } } }, "D1")).toBe("3.4");
    expect(shareTs({ shares: { public: { C2: [{ ts: "1.2" }] } } }, "C1")).toBeUndefined();
    expect(shareTs({}, "C1")).toBeUndefined();
  });
});

describe("attachment pinning", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slack-axi-attach-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("pins path, name, size, digest, and snippet type", () => {
    const p = join(dir, "q.sql");
    writeFileSync(p, "SELECT 1;\n");
    const att = pinAttachment(p, "snippet");
    expect(att).toMatchObject({ path: p, name: "q.sql", size: 10, snippet_type: "sql" });
    expect(att.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pinAttachment(p, "file").snippet_type).toBeUndefined();
    expect(describeAttachment(att)).toEqual({
      name: "q.sql",
      kind: "snippet (sql)",
      size: "10B",
      path: p,
    });
  });

  it("refuses missing, empty, directory, and binary-as-snippet paths", () => {
    const empty = join(dir, "empty.txt");
    writeFileSync(empty, "");
    const bin = join(dir, "a.bin");
    writeFileSync(bin, Buffer.from([0x89, 0x50, 0x00, 0x47]));
    expect(() => pinAttachment(join(dir, "nope"), "file")).toThrow(/no such file/);
    expect(() => pinAttachment(dir, "file")).toThrow(/no such file/);
    expect(() => pinAttachment(empty, "file")).toThrow(/empty/);
    expect(() => pinAttachment(bin, "snippet")).toThrow(/not a text file/);
    expect(pinAttachment(bin, "file").size).toBe(4);
  });

  it("send-time read returns the bytes, or ATTACHMENT_CHANGED if changed or gone", () => {
    const p = join(dir, "shot.png");
    writeFileSync(p, "v1");
    const att = pinAttachment(p, "file");
    expect(readPinnedAttachment(att).toString()).toBe("v1");
    writeFileSync(p, "v2");
    expect(() => readPinnedAttachment(att)).toThrow(
      expect.objectContaining({ code: "ATTACHMENT_CHANGED" }),
    );
    rmSync(p);
    expect(() => readPinnedAttachment(att)).toThrow(
      expect.objectContaining({ code: "ATTACHMENT_CHANGED" }),
    );
  });
});
