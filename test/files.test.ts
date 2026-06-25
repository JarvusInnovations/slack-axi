import { describe, expect, it } from "vitest";
import { formatSize, summarizeFiles, toFileMeta } from "../src/slack/files.js";

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
    expect(f).toMatchObject({ id: "F0B8Q0DCAA3", name: "IMG_2731.jpg", filetype: "jpg", size: 161608 });
    expect(f.unavailable).toBeUndefined();
  });

  it("flags a tombstoned file as unavailable", () => {
    expect(toFileMeta({ id: "F1", mode: "tombstone" }).unavailable).toBe(true);
  });

  it("flags an access-denied file as unavailable", () => {
    expect(toFileMeta({ id: "F2", name: "secret.pdf", file_access: "access_denied" }).unavailable).toBe(true);
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
