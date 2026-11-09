import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
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
  /** True for a snippet (`mode: "snippet"`): text with a syntax type, shown as a code viewer. */
  snippet?: boolean;
  /** Total line count, when the payload carries it (snippets/text files). */
  lines?: number;
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
    ...(raw.mode === "snippet" ? { snippet: true } : {}),
    ...(typeof raw.lines === "number" ? { lines: raw.lines } : {}),
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
      if (f.snippet) {
        const lines =
          typeof f.lines === "number" ? `, ${f.lines} line${f.lines === 1 ? "" : "s"}` : "";
        return `${f.name} (snippet: ${f.filetype ?? "text"}${lines}) [${f.id}]`;
      }
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
  const bytes = await fetchFileBytes(session, file);
  const name = safeName(typeof file.name === "string" ? file.name : id, id);
  mkdirSync(outDir, { recursive: true });
  let target = join(outDir, name);
  if (existsSync(target)) target = join(outDir, `${id}-${name}`);
  writeFileSync(target, bytes);

  return {
    id,
    name,
    filetype: typeof file.filetype === "string" ? file.filetype : "",
    size: formatSize(typeof file.size === "number" ? file.size : undefined),
    path: isAbsolute(target) ? target : resolvePath(target),
  };
}

/**
 * Fetch a file's bytes from `url_private_download` (or `url_private`) with the workspace token as a
 * Bearer credential. Slack answers HTTP 200 with its login HTML when the token lacks `files:read`; that
 * is detected (content-type) and raised as `SCOPE_MISSING`, never returned as bytes. See files.md.
 */
export async function fetchFileBytes(
  session: Session,
  file: Record<string, unknown>,
): Promise<Buffer> {
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
  if (!res.ok || contentType.includes("text/html")) {
    throw new AxiError(
      "Could not download file bytes — token is likely missing `files:read`",
      "SCOPE_MISSING",
      ["Re-run `slack-axi auth setup`, add the `files:read` scope, and re-install the app"],
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------- text + snippets

const TEXT_MIMETYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/x-sh",
]);

/** Whether a file is text (printable by `file`): a snippet, `text/*`, or a known text mimetype. */
export function isTextFile(file: { mode?: unknown; mimetype?: unknown }): boolean {
  if (file.mode === "snippet") return true;
  const mime = typeof file.mimetype === "string" ? file.mimetype.split(";")[0].trim() : "";
  return mime.startsWith("text/") || TEXT_MIMETYPES.has(mime);
}

const SNIPPET_TYPES: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".diff": "diff",
  ".patch": "diff",
  ".tf": "terraform",
  ".txt": "text",
  ".log": "text",
  ".csv": "csv",
};

/** A snippet's syntax type from its file extension; `Dockerfile` → `dockerfile`; unknown → `text`. */
export function snippetType(path: string): string {
  const name = basename(path);
  if (/^dockerfile$/i.test(name)) return "dockerfile";
  return SNIPPET_TYPES[extname(name).toLowerCase()] ?? "text";
}

/** The first `max` lines of `text` (all when `max` is undefined), plus the total line count. */
export function clipLines(
  text: string,
  max?: number,
): { text: string; shown: number; total: number } {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = body.length === 0 ? [] : body.split("\n");
  const shown = max === undefined ? lines.length : Math.min(max, lines.length);
  return { text: lines.slice(0, shown).join("\n"), shown, total: lines.length };
}

// ---------------------------------------------------------------------------- attachments (upload)

/** A local file pinned to a draft at preparation time: what was reviewed is what is sent. */
export interface Attachment {
  path: string;
  name: string;
  size: number;
  sha256: string;
  /** Present for a snippet: its syntax type. */
  snippet_type?: string;
}

/** Slack's per-message file limit. */
export const MAX_ATTACHMENTS = 10;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Check a local file and pin it for a draft: absolute path, name, size, SHA-256, and (for a snippet)
 * its syntax type. A missing/non-regular/empty file, or a binary file passed as a snippet → `USAGE`.
 */
export function pinAttachment(path: string, kind: "file" | "snippet"): Attachment {
  const abs = resolvePath(path);
  const flag = kind === "snippet" ? "--snippet" : "--file";
  let size: number;
  try {
    const st = statSync(abs);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw new AxiError(`${flag} ${path}: no such file`, "USAGE", [
      "Pass the path of an existing local file",
    ]);
  }
  if (size === 0) {
    throw new AxiError(`${flag} ${path}: file is empty`, "USAGE", [
      "Slack does not accept empty uploads",
    ]);
  }
  const bytes = readFileSync(abs);
  if (kind === "snippet" && bytes.includes(0)) {
    throw new AxiError(`--snippet ${path}: not a text file`, "USAGE", [
      `Attach it as a file instead: \`--file ${path}\``,
    ]);
  }
  return {
    path: abs,
    name: basename(abs),
    size,
    sha256: sha256(bytes),
    ...(kind === "snippet" ? { snippet_type: snippetType(abs) } : {}),
  };
}

/** Re-read a pinned attachment and return its bytes, or throw `ATTACHMENT_CHANGED` if it differs. */
export function readPinnedAttachment(att: Attachment): Buffer {
  let bytes: Buffer;
  try {
    bytes = readFileSync(att.path);
  } catch {
    throw attachmentChanged(att, "is gone");
  }
  if (sha256(bytes) !== att.sha256)
    throw attachmentChanged(att, "changed since the draft was made");
  return bytes;
}

function attachmentChanged(att: Attachment, what: string): AxiError {
  return new AxiError(`Attachment ${att.path} ${what}; nothing was sent`, "ATTACHMENT_CHANGED", [
    "Discard this draft and create a new one so the reviewed contents match what is sent",
  ]);
}

/** One row of a draft's `attachments[N]{name,kind,size,path}` echo. */
export function describeAttachment(att: Attachment): Record<string, string> {
  return {
    name: att.name,
    kind: att.snippet_type ? `snippet (${att.snippet_type})` : "file",
    size: formatSize(att.size),
    path: att.path,
  };
}

/** Where an upload is shared, and the message that carries it. */
export interface ShareTarget {
  channelId: string;
  threadTs?: string;
  /** Message text (`initial_comment`); takes precedence over `blocks` per Slack. */
  text?: string;
  blocks?: unknown[];
}

/**
 * Upload pinned attachments without sharing them yet: every attachment is verified first
 * (`ATTACHMENT_CHANGED` → nothing uploaded), then `files.getUploadURLExternal` per file and the bytes
 * POSTed to each upload URL. Returns the file ids for `shareFiles`. Needs `files:write`.
 */
export async function uploadFiles(session: Session, attachments: Attachment[]): Promise<string[]> {
  const bytes = attachments.map(readPinnedAttachment);
  const ids: string[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const res = await session.client.files.getUploadURLExternal({
      filename: att.name,
      length: bytes[i].length,
      ...(att.snippet_type ? { snippet_type: att.snippet_type } : {}),
    });
    const put = await fetch(String(res.upload_url ?? ""), {
      method: "POST",
      body: new Uint8Array(bytes[i]),
    });
    if (!put.ok) {
      throw new AxiError(`Upload of ${att.name} failed (HTTP ${put.status})`, "UPLOAD_FAILED", [
        "Retry `slack-axi draft send`; nothing was posted",
      ]);
    }
    ids.push(String(res.file_id ?? ""));
  }
  return ids;
}

/**
 * Share uploaded files in one message via `files.completeUploadExternal`: `text` becomes the
 * `initial_comment`; otherwise `blocks` carry the message (Slack ignores blocks when both are given).
 */
export async function shareFiles(
  session: Session,
  ids: string[],
  names: string[],
  target: ShareTarget,
): Promise<void> {
  const files = ids.map((id, i) => ({ id, title: names[i] ?? id })) as [
    { id: string; title: string },
    ...Array<{ id: string; title: string }>,
  ];
  const dest = target.threadTs
    ? { channel_id: target.channelId, thread_ts: target.threadTs }
    : { channel_id: target.channelId };
  await session.client.files.completeUploadExternal({
    files,
    ...dest,
    ...(target.text ? { initial_comment: target.text } : {}),
    ...(!target.text && target.blocks ? { blocks: target.blocks as never } : {}),
  });
}

/** The ts of a file's share in `channelId`, from a `files.info` file object (`shares.public|private`). */
export function shareTs(file: Record<string, unknown>, channelId: string): string | undefined {
  const shares = (file.shares ?? {}) as Record<string, Record<string, Array<{ ts?: string }>>>;
  for (const scope of ["public", "private"]) {
    const ts = shares[scope]?.[channelId]?.[0]?.ts;
    if (typeof ts === "string" && ts.length > 0) return ts;
  }
  return undefined;
}

/**
 * Poll `files.info` until the uploaded file shows its share in `channelId` (Slack reports it
 * asynchronously), up to ~`timeoutMs`. Returns the shared message's ts, or `undefined` on timeout.
 */
export async function findShareTs(
  session: Session,
  fileId: string,
  channelId: string,
  timeoutMs = 10_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ts = shareTs(await fetchFileInfo(session, fileId), channelId);
    if (ts || Date.now() >= deadline) return ts;
    await new Promise((r) => setTimeout(r, 750));
  }
}
