import { AxiError } from "axi-sdk-js";
import { takeFlag } from "../flags.js";
import { encodeObject, joinBlocks, renderList, truncate } from "../output.js";
import { activeSession } from "../session.js";
import { ensureUsers, allCachedUsers } from "../slack/cache.js";
import { toAxiError } from "../slack/errors.js";
import { formatText, userName } from "../slack/format.js";
import { getPermalink } from "../slack/permalink.js";
import { fetchReactions, orderReactions } from "../slack/reactions.js";
import { channelLabel, resolveChannel } from "../slack/resolve.js";
import { dottedTs, handle } from "../slack/ts.js";

export const REACTIONS_HELP = `usage: slack-axi reactions <channel> <ts>
Lists every emoji reaction on a message and the complete roster of who reacted (names resolved).
The read counterpart to \`react\`. ts may be dotless or dotted.
examples:
  slack-axi reactions #eng 1717589640123456
  slack-axi reactions C0123ABCD 1717589640.123456`;

export async function reactionsCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return REACTIONS_HELP;
  const team = takeFlag(args, "--team");
  const [channelArg, tsArg] = team.rest.filter((a) => !a.startsWith("-"));
  if (!channelArg || !tsArg) {
    throw new AxiError("usage: slack-axi reactions <channel> <ts>", "USAGE", [
      "Pass a channel and a ts handle from a `read`/`search`/`thread` row",
    ]);
  }

  const session = await activeSession({ teamFlag: team.value });
  const channel = await resolveChannel(session, channelArg);
  const ts = dottedTs(tsArg);

  let message;
  try {
    message = await fetchReactions(session, channel.id, ts);
  } catch (err) {
    throw toAxiError(err, { team: session.teamId, channel: channelArg });
  }
  if (!message) {
    throw new AxiError("Message not found", "MESSAGE_NOT_FOUND", ["Check the ts and channel"]);
  }

  const label = await channelLabel(session, channel);
  await ensureUsers(session);
  const users = allCachedUsers(session.teamId);

  const author = message.user
    ? userName(message.user, users)
    : message.botId
      ? "(bot)"
      : "(system)";
  const preview = truncate(formatText(message.text, users), 120);
  const header: Record<string, unknown> = {
    workspace: `${session.teamName ?? session.teamId} (${session.teamId})`,
    channel: `${label} (${channel.id}, ${channel.type})`,
    message: `${author}: ${preview}`.trim(),
    ts: handle(message.ts),
    permalink: await getPermalink(session, channel.id, message.ts),
  };

  if (message.reactions.length === 0) {
    return joinBlocks(
      encodeObject({
        ...header,
        reactions: `0 reactions on ${label} message ${handle(message.ts)}`,
      }),
    );
  }

  header.complete = true;
  const rows = orderReactions(message.reactions).map((r) => ({
    emoji: `:${r.name}:`,
    count: r.count,
    users: r.users.map((id) => userName(id, users)).join(", "),
  }));

  return joinBlocks(encodeObject(header), renderList("reactions", rows));
}
