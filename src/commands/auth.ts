import { AxiError } from "axi-sdk-js";
import {
  getDefaultTeam,
  listWorkspaces,
  removeWorkspace,
  setDefaultTeam,
  writeStoredToken,
} from "../config.js";
import { takeFlag } from "../flags.js";
import { encodeBlock, joinBlocks, renderHelp, renderList } from "../output.js";
import { validateToken } from "../slack/client.js";
import { toAxiError } from "../slack/errors.js";
import { missingScopes, REQUIRED_SCOPES } from "../slack/scopes.js";

export const AUTH_HELP = `usage: slack-axi auth <subcommand> [flags]
subcommands[5]:
  setup                    Show how to create a Slack app and obtain a user token
  login --token <xoxp-...> Validate and store a token (derives team/user/scopes)
  workspaces               List authenticated workspaces (default marked)
  use <team>               Set the default workspace
  revoke <team>            Delete a workspace's stored token
flags[2]:
  --team <id>              Target a specific workspace (login/use/revoke)
  --token <xoxp-...>       The user token to store (login)
examples:
  slack-axi auth setup
  slack-axi auth login --token xoxp-...
  slack-axi auth workspaces
  slack-axi auth use T01ABC`;

const SETUP_HELP = `Create a Slack app and obtain a user token:
  1. Create an app at https://api.slack.com/apps (From scratch), pick the workspace.
  2. OAuth & Permissions → User Token Scopes → add:
     ${REQUIRED_SCOPES.join(" ")}
  3. Install to Workspace → copy the User OAuth Token (starts with xoxp-).
  4. Run: slack-axi auth login --token xoxp-...`;

export async function authCommand(args: string[]): Promise<string> {
  if (args.includes("--help") || args.length === 0) return AUTH_HELP;

  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "setup":
      return setup();
    case "login":
      return login(rest);
    case "workspaces":
      return workspaces();
    case "use":
      return use(rest);
    case "revoke":
      return revoke(rest);
    default:
      throw new AxiError(`Unknown auth subcommand: ${sub}`, "USAGE", [
        "Subcommands: setup, login, workspaces, use, revoke",
      ]);
  }
}

function setup(): string {
  return joinBlocks(encodeBlock("setup", { note: "manual app creation — token-based auth" }), SETUP_HELP);
}

async function login(args: string[]): Promise<string> {
  const { value: token, rest } = takeFlag(args, "--token");
  const { value: teamFlag } = takeFlag(rest, "--team");
  if (!token) {
    throw new AxiError("--token is required", "USAGE", [
      "slack-axi auth login --token xoxp-...",
      "Run `slack-axi auth setup` to obtain a token",
    ]);
  }

  let identity;
  try {
    identity = await validateToken(token);
  } catch (err) {
    throw toAxiError(err, teamFlag ? { team: teamFlag } : {});
  }

  if (teamFlag && teamFlag !== identity.teamId) {
    throw new AxiError(
      `Token belongs to workspace ${identity.teamId} (${identity.teamName}), not ${teamFlag}`,
      "TEAM_MISMATCH",
      ["Re-run without --team, or pass the matching workspace id"],
    );
  }

  writeStoredToken({
    team_id: identity.teamId,
    team_name: identity.teamName,
    user_id: identity.userId,
    user_name: identity.userName,
    token,
    scopes: identity.scopes,
    obtained_at: new Date().toISOString(),
  });

  const missing = missingScopes(identity.scopes);
  const summary = encodeBlock("authenticated", {
    workspace: `${identity.teamName} (${identity.teamId})`,
    user: identity.userName ? `${identity.userName} (${identity.userId})` : identity.userId,
    scopes: missing.length === 0 ? "all required scopes granted" : `missing ${missing.length}`,
    default: getDefaultTeam() === identity.teamId,
  });

  const help =
    missing.length > 0
      ? renderHelp([`Add missing scopes (${missing.join(", ")}) via \`slack-axi auth setup\`, then re-install + re-login`])
      : "";
  return joinBlocks(summary, help);
}

function workspaces(): string {
  const stored = listWorkspaces();
  if (stored.length === 0) {
    return joinBlocks(
      encodeBlock("workspaces", "0 workspaces authenticated"),
      renderHelp(["Run `slack-axi auth setup` to create an app and store a token"]),
    );
  }
  const def = getDefaultTeam();
  const rows = stored.map((w) => ({
    team: w.team_id,
    name: w.team_name,
    user: w.user_name ?? w.user_id,
    default: w.team_id === def,
  }));
  return joinBlocks(
    renderList("workspaces", rows),
    renderHelp(["Run `slack-axi auth use <team>` to change the default"]),
  );
}

function use(args: string[]): string {
  const team = args.find((a) => !a.startsWith("-"));
  if (!team) throw new AxiError("usage: slack-axi auth use <team>", "USAGE", []);
  const known = listWorkspaces().some((w) => w.team_id === team);
  if (!known) {
    throw new AxiError(`Workspace ${team} is not authenticated`, "TEAM_NOT_FOUND", [
      `Authenticated: ${listWorkspaces().map((w) => w.team_id).join(", ") || "(none)"}`,
    ]);
  }
  if (getDefaultTeam() === team) return encodeBlock("default", `${team} already default (no-op)`);
  setDefaultTeam(team);
  return encodeBlock("default", team);
}

function revoke(args: string[]): string {
  const team = args.find((a) => !a.startsWith("-"));
  if (!team) throw new AxiError("usage: slack-axi auth revoke <team>", "USAGE", []);
  const existed = removeWorkspace(team);
  return encodeBlock("revoked", existed ? team : `${team} (was not stored — no-op)`);
}
