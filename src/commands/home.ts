import { listWorkspaceIds, resolveActiveToken } from "../config.js";
import { encodeBlock, joinBlocks, renderHelp } from "../output.js";
import { cachedChannels } from "../slack/cache.js";

/**
 * Content-first no-args view. See specs/commands/home.md. The SDK prepends the bin/description
 * header; this returns the live state below it.
 * In plan 01 this shows auth/workspace state; unread + top-channels arrive with plan 02.
 */
export async function homeCommand(): Promise<string> {
  let active;
  try {
    active = resolveActiveToken({});
  } catch {
    // No token resolvable → setup-oriented home.
    return renderHelp([
      "Run `slack-axi auth setup` to create a Slack app and obtain a user token",
      "Then `slack-axi auth login --token xoxp-...`",
      "Run `slack-axi --help` to see the full command list, or `slack-axi <command> --help` for usage on any command",
    ]);
  }

  const workspaceLabel = active.teamName
    ? `${active.teamName} (${active.teamId ?? "?"})`
    : active.teamId ?? "(from SLACK_AXI_TOKEN)";

  const stored = listWorkspaceIds();
  // Cache-only (no network): home loads on every session, so never refresh here.
  const channelCount = active.teamId ? cachedChannels(active.teamId).filter((c) => c.is_member).length : 0;

  const statusFields: Record<string, unknown> = { workspace: workspaceLabel };
  if (channelCount > 0) statusFields.your_channels = channelCount;
  const status = encodeBlock("status", statusFields);

  const help: string[] = ["Run `slack-axi channels` to list your channels (all types)"];
  if (stored.length > 1) help.push("Run `slack-axi auth workspaces` to see all workspaces");
  help.push("Run `slack-axi doctor` to verify auth + scopes");
  help.push("Run `slack-axi --help` to see the full command list, or `slack-axi <command> --help` for usage on any command");

  return joinBlocks(status, renderHelp(help));
}
