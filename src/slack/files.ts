import { mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import type { Session } from "../session.js";

/** A file attached to a message — metadata only; bytes are fetched on demand by `download`. */
export interface FileMeta {
  id: string;
  name: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  /** Slack web detail page (citation); not the byte source. */
  permalink?: string;
  /** True when the file is a tombstone / access-denied placeholder (no downloadable bytes). */
  unavailable?: boolean;
}

/** Normalize a raw Slack file object from a message's `files[]` (history/replies payload). */
export function toFileMeta(raw: Record<string, unknown>): FileMeta {
  const id = typeof raw.id === "string" ? raw.id : "";
  const access = typeof raw.file_access === "string" ? raw.file_access : undefined;
  const unavailable = raw.mode === "tombstone" || (access !== undefined && access !== "visible");
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : typeof raw.title === "string" ? raw.title : id,
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    ...(typeof raw.mimetype === "string" ? { mimetype: raw.mimetype } : {}),
    ...(typeof raw.filetype === "string" ? { filetype: raw.filetype } : {}),
    ...(typeof raw.size === "number" ? { size: raw.size } : {}),
    ...(typeof raw.permalink === "string" ? { permalink: raw.permalink } : {}),
    ...(unavailable ? { unavailable: true } : {}),
  };
}

/** Human-readable byte size: `512B`, `158KB`, `1.2MB`. */
export function formatSize(bytes?: number): string {
  if (typeof bytes !== "number" || bytes < 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Inline summary for a `read`/`thread` row: `IMG_2731.jpg (jpg, 158KB) [F0B…]; report.pdf [F1A…]`,
 * `; `-joined, in payload order. An inaccessible file shows `(unavailable) [F-id]`. The `[F-id]` is the
 * handle for `slack-axi download`. Empty input → `""`. Pure, so it's unit-testable. See files.md.
 */
export function summarizeFiles(files: FileMeta[]): string {
  return files
    .map((f) => {
      if (f.unavailable) return `(unavailable) [${f.id}]`;
      const meta = [f.filetype, formatSize(f.size)].filter(Boolean).join(", ");
      return `${f.name}${meta ? ` (${meta})` : ""} [${f.id}]`;
    })
    .join("; ");
}

/** Fetch the canonical file object via `files.info` (needs `files:read`). Throws on a Slack error. */
export async function fetchFileInfo(
  session: Session,
  id: string,
): Promise<Record<string, unknown>> {
  const res = await session.client.files.info({ file: id });
  return (res.file ?? {}) as Record<string, unknown>;
}

/** The saved result of a successful download. */
export interface DownloadResult {
  id: string;
  name: string;
  filetype: string;
  size: string;
  path: string;
}

/** Strip any directory components from a Slack-supplied filename so it can't escape `outDir`. */
function safeName(name: string, id: string): string {
  const base = basename(name).replace(/^\.+/, "").trim();
  return base.length > 0 ? base : id;
}

/**
 * Download a file's bytes to `outDir`, returning the saved absolute path + metadata. Fetches
 * `url_private_download` with the workspace token as a Bearer credential. A missing `files:read` scope
 * makes Slack answer HTTP 200 with its login HTML rather than the bytes; we detect that (content-type)
 * and raise `SCOPE_MISSING` instead of writing a corrupt file. Needs `files:read`. See files.md.
 */
export async function downloadFile(
  session: Session,
  file: Record<string, unknown>,
  outDir: string,
): Promise<DownloadResult> {
  const id = typeof file.id === "string" ? file.id : "";
  const url =
    (typeof file.url_private_download === "string" && file.url_private_download) ||
    (typeof file.url_private === "string" && file.url_private) ||
    "";
  if (!url) {
    throw new AxiError(`File ${id} has no downloadable content`, "FILE_UNAVAILABLE", [
      "It may be a tombstoned, external, or restricted file",
    ]);
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
  const contentType = res.headers.get("content-type") ?? "";
  // Slack returns its login page (HTML, 200) when the token lacks files:read — never the bytes.
  if (!res.ok || contentType.includes("text/html")) {
    throw new AxiError(
      "Could not download file bytes — token is likely missing `files:read`",
      "SCOPE_MISSING",
      ["Re-run `slack-axi auth setup`, add the `files:read` scope, and re-install the app"],
    );
  }

  const name = safeName(typeof file.name === "string" ? file.name : id, id);
  mkdirSync(outDir, { recursive: true });
  let target = join(outDir, name);
  if (existsSync(target)) target = join(outDir, `${id}-${name}`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));

  return {
    id,
    name,
    filetype: typeof file.filetype === "string" ? file.filetype : "",
    size: formatSize(typeof file.size === "number" ? file.size : undefined),
    path: isAbsolute(target) ? target : resolvePath(target),
  };
}
