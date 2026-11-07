import { AxiError } from "axi-sdk-js";
import { takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderHelp, renderList } from "../output.js";
import { activeSession } from "../session.js";
import { toAxiError } from "../slack/errors.js";
import { downloadFile, type DownloadResult, fetchFileInfo } from "../slack/files.js";

export const DOWNLOAD_HELP = `usage: slack-axi download <file-id...> [--out <dir>]
Downloads message attachments (file ids F… from a read/thread files column) to local files and prints
the saved paths so you can open them. Read-only against Slack; needs the files:read scope.
flags[1]:
  --out <dir>   Directory to save into (default: current directory; created if missing)
examples:
  slack-axi download F0B8Q0DCAA3
  slack-axi download F0B8Q0DCAA3 F0B9ZNJ1EBS --out ./shots`;

export async function downloadCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return DOWNLOAD_HELP;
  const team = takeFlag(args, "--team");
  const out = takeFlag(team.rest, "--out");
  const ids = out.rest.filter((a) => !a.startsWith("-"));
  if (ids.length === 0) {
    throw new AxiError("usage: slack-axi download <file-id...> [--out <dir>]", "USAGE", [
      "Pass one or more file ids (F…) from a `read`/`thread` files column",
    ]);
  }
  const outDir = out.value ?? process.cwd();

  const session = await activeSession({ teamFlag: team.value });

  const done: DownloadResult[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    try {
      const file = await fetchFileInfo(session, id);
      done.push(await downloadFile(session, file, outDir));
    } catch (err) {
      const ax = toAxiError(err, { team: session.teamId });
      // A missing files:read scope blocks every download — surface it once as a command-level failure
      // rather than reporting it per id.
      if (ax.code === "SCOPE_MISSING") {
        throw new AxiError(
          "Cannot download: token is missing the `files:read` scope",
          "SCOPE_MISSING",
          [
            "Re-run `slack-axi auth setup`, add `files:read`, and re-install the app, then retry",
            "Run `slack-axi doctor` to confirm scope coverage",
          ],
        );
      }
      failed.push({ id, reason: ax.code });
    }
  }

  if (done.length === 0) {
    throw new AxiError(
      `No files downloaded (${failed.map((f) => `${f.id}: ${f.reason}`).join(", ")})`,
      "FILE_NOT_FOUND",
      ["Check the file ids from a `read`/`thread` files column"],
    );
  }

  const rows = done.map((d) => ({
    file: d.id,
    name: d.name,
    type: d.filetype,
    size: d.size,
    path: d.path,
  }));
  const help = [
    "Open a saved path with your file-reading tool to view the image/PDF",
    failed.length > 0
      ? `Failed: ${failed.map((f) => `${f.id} (${f.reason})`).join(", ")}`
      : undefined,
  ].filter((l): l is string => Boolean(l));

  return joinBlocks(
    encodeObject({ workspace: `${session.teamName ?? session.teamId} (${session.teamId})` }),
    renderList("downloaded", rows, { total: done.length }),
    renderHelp(help),
  );
}
