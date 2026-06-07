import { AxiError } from "axi-sdk-js";
import { takeFlag } from "../flags.js";
import { encodeBlock } from "../output.js";
import { activeSession } from "../session.js";
import { refreshMemberChannels, refreshUsers } from "../slack/cache.js";

export const CACHE_HELP = `usage: slack-axi cache refresh [--team <id>]
Rebuilds the local channel + user caches used for name<->id and user resolution.`;

export async function cacheCommand(args: string[]): Promise<string> {
  if (args.includes("--help") || args.length === 0) return CACHE_HELP;
  const sub = args[0];
  const team = takeFlag(args.slice(1), "--team");
  if (sub !== "refresh") {
    throw new AxiError(`Unknown cache subcommand: ${sub}`, "USAGE", ["Only `cache refresh` is supported"]);
  }

  const session = await activeSession({ teamFlag: team.value });
  const channels = await refreshMemberChannels(session);
  await refreshUsers(session);
  return encodeBlock("cache", {
    workspace: `${session.teamName ?? session.teamId} (${session.teamId})`,
    channels: channels.length,
    refreshed: "channels + users",
  });
}
