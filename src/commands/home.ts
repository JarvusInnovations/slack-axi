import { listWorkspaceIds, resolveActiveToken } from "../config.js";
import { encodeBlock, joinBlocks, renderHelp } from "../output.js";

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
    ]);
  }

  const workspaceLabel = active.teamName
    ? `${active.teamName} (${active.teamId ?? "?"})`
    : active.teamId ?? "(from SLACK_AXI_TOKEN)";

  const stored = listWorkspaceIds();
  const status = encodeBlock("workspace", workspaceLabel);

  const help: string[] = ["Run `slack-axi doctor` to verify auth + scopes"];
  if (stored.length > 1) help.push("Run `slack-axi auth workspaces` to see all workspaces");
  help.push("Run `slack-axi --help` for the full command list");

  return joinBlocks(status, renderHelp(help));
}
