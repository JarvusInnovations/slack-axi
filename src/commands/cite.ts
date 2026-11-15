import { parseCommand, str, usageError } from "../flags.js";
import { encodeObject, joinBlocks, renderList } from "../output.js";
import { activeSession } from "../session.js";
import { getPermalink } from "../slack/permalink.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { dottedTs, handle } from "../slack/ts.js";

export const CITE_HELP = `usage: slack-axi cite <channel> <ts> [<ts> ...]
Reconstructs permalinks (and the HQ slack_message {channel, ts, permalink} shape) for the given
message handles. Stateless — channel + ts is all it needs. ts may be dotless or dotted.
examples:
  slack-axi cite #eng 1717589640123456
  slack-axi cite C0123ABCD 1717589640123456 1717589700234567`;

export async function citeCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return CITE_HELP;
  const parsed = parseCommand("cite", args);
  const [target, ...tsArgs] = parsed.positional;
  if (!target || tsArgs.length === 0) {
    throw usageError("cite", [
      "Pass a channel and one or more ts handles from a `read`/`search` row",
    ]);
  }

  const session = await activeSession({ teamFlag: str(parsed, "--team") });
  const channel = await resolveChannel(session, target);

  const rows = await Promise.all(
    tsArgs.map(async (raw) => {
      const ts = dottedTs(raw);
      try {
        return { ts: handle(ts), permalink: await getPermalink(session, channel.id, ts) };
      } catch {
        return { ts: handle(ts), permalink: "(not found in this channel)" };
      }
    }),
  );

  return joinBlocks(
    encodeObject({
      workspace: `${session.teamName ?? session.teamId} (${session.teamId})`,
      channel: `${await channelLabel(session, channel)} (${channel.id})`,
    }),
    renderList("citations", rows),
  );
}
