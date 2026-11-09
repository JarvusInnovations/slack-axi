import { AxiError } from "axi-sdk-js";
import { takeBool, takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp } from "../output.js";
import { activeSession, type Session } from "../session.js";
import { toAxiError } from "../slack/errors.js";
import { addScopesHelp } from "../slack/scopes.js";
import {
  clipLines,
  fetchFileBytes,
  fetchFileInfo,
  formatSize,
  isTextFile,
} from "../slack/files.js";

export const FILE_HELP = `usage: slack-axi file <file-id...> [--full]
Shows files attached to messages (ids F… from a read/thread files column): metadata, and for snippets
and text files their text, inline. Binary files (images, PDFs) show metadata only — use \`download\`.
Text is capped at ${200} lines unless --full. Read-only; needs the files:read scope.
flags[1]:
  --full   Print every line of each text file
examples:
  slack-axi file F0B8Q0DCAA3
  slack-axi file F0B8Q0DCAA3 --full`;

/** Lines of text shown per file by default. See specs/commands/file.md. */
export const FILE_LINE_CAP = 200;

/**
 * Render one file's block: metadata, then `shown: N of M lines` and the text under `content: |`
 * (each line indented two spaces), or `content: (binary — use download)`. Pure given the bytes.
 */
export function renderFileBlock(
  file: Record<string, unknown>,
  text: string | undefined,
  full: boolean,
): { block: string; clipped: boolean } {
  const str = (k: string) => (typeof file[k] === "string" ? (file[k] as string) : undefined);
  const head: Record<string, unknown> = {
    file: str("id") ?? "",
    name: str("name") ?? str("title") ?? str("id") ?? "",
    type: str("filetype") ?? str("mimetype") ?? "",
    ...(file.mode === "snippet" ? { snippet: true } : {}),
    size: formatSize(typeof file.size === "number" ? file.size : undefined),
  };
  if (text === undefined) {
    const permalink = str("permalink");
    return {
      block: joinBlocks(
        encodeObject({
          ...head,
          ...(permalink ? { permalink } : {}),
          content: "(binary — use download)",
        }),
      ),
      clipped: false,
    };
  }
  const clip = clipLines(text, full ? undefined : FILE_LINE_CAP);
  const permalink = str("permalink");
  const meta = encodeObject({
    ...head,
    lines: clip.total,
    shown: `${clip.shown} of ${clip.total} lines`,
    ...(permalink ? { permalink } : {}),
  });
  const body =
    clip.text.length === 0
      ? "content: |"
      : `content: |\n${clip.text
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}`;
  return { block: `${meta}\n${body}`, clipped: clip.shown < clip.total };
}

export async function fileCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return FILE_HELP;
  const team = takeFlag(args, "--team");
  const full = takeBool(team.rest, "--full");
  const ids = full.rest.filter((a) => !a.startsWith("-"));
  if (ids.length === 0) {
    throw new AxiError("usage: slack-axi file <file-id...> [--full]", "USAGE", [
      "Pass one or more file ids (F…) from a `read`/`thread` files column",
    ]);
  }

  const session = await activeSession({ teamFlag: team.value });
  const blocks: string[] = [];
  const binaries: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  let clipped = false;
  for (const id of ids) {
    try {
      const r = await showFile(session, id, full.present);
      blocks.push(r.block);
      if (r.binary) binaries.push(id);
      clipped ||= r.clipped;
    } catch (err) {
      const ax = toAxiError(err, { team: session.teamId });
      // A missing files:read scope blocks every file — surface it once as a command-level failure.
      if (ax.code === "SCOPE_MISSING") {
        throw new AxiError(
          "Cannot read files: token is missing the `files:read` scope",
          "SCOPE_MISSING",
          [...addScopesHelp(["files:read"])],
        );
      }
      failed.push({ id, reason: ax.code });
    }
  }

  if (blocks.length === 0) {
    throw new AxiError(
      `No files shown (${failed.map((f) => `${f.id}: ${f.reason}`).join(", ")})`,
      "FILE_NOT_FOUND",
      ["Check the file ids from a `read`/`thread` files column"],
    );
  }

  const help = [
    clipped
      ? `Text was cut at ${FILE_LINE_CAP} lines; re-run with \`--full\` for every line`
      : undefined,
    binaries.length > 0
      ? `Run \`slack-axi download ${binaries.join(" ")}\` to save binary files to disk`
      : undefined,
    failed.length > 0
      ? `Failed: ${failed.map((f) => `${f.id} (${f.reason})`).join(", ")}`
      : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeObject({ workspace: `${session.teamName ?? session.teamId} (${session.teamId})` }),
    blocks.join("\n\n"),
    help.length > 0 ? `\n${renderHelp(help)}` : "",
  );
}

async function showFile(
  session: Session,
  id: string,
  full: boolean,
): Promise<{ block: string; clipped: boolean; binary: boolean }> {
  const file = await fetchFileInfo(session, id);
  if (!isTextFile(file)) return { ...renderFileBlock(file, undefined, full), binary: true };
  const bytes = await fetchFileBytes(session, file);
  return { ...renderFileBlock(file, bytes.toString("utf-8"), full), binary: false };
}
