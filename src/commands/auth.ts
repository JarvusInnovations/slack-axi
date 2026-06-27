import { AxiError } from "axi-sdk-js";
import {
  getDefaultTeam,
  listWorkspaces,
  removeWorkspace,
  setDefaultTeam,
  writeStoredToken,
} from "../config.js";
import { takeBool, takeFlag } from "../flags.js";
import { collapseHome, encodeBlock, joinBlocks, renderHelp, renderList } from "../output.js";
import {
  buildManifest,
  markAppCreated,
  NEW_APP_URL,
  readSetupState,
  resetSetup,
  setAppName,
  setupProgress,
  writeManifestFile,
  writeSetupHtmlFile,
} from "../auth/setup.js";
import { validateToken } from "../slack/client.js";
import { toAxiError } from "../slack/errors.js";
import { missingScopes } from "../slack/scopes.js";

export const AUTH_HELP = `usage: slack-axi auth <subcommand> [flags]
subcommands[5]:
  setup                    Progressive guided setup: create an app from a manifest, then log in
  login --token <xoxp-...> Validate and store a token (derives team/user/scopes)
  workspaces               List authenticated workspaces (default marked)
  use <team>               Set the default workspace
  revoke <team>            Delete a workspace's stored token
setup flags[4]:
  --name <name>            App display name in the manifest (default: slack-axi)
  --confirm-step <step>    Mark a manual step done (step: app_created)
  --show-manifest          Also print the manifest YAML inline
  --reset                  Clear setup state (e.g. to set up another workspace)
flags[2]:
  --team <id>              Target a specific workspace (login/use/revoke)
  --token <xoxp-...>       The user token to store (login)
examples:
  slack-axi auth setup
  slack-axi auth setup --confirm-step app_created
  slack-axi auth login --token xoxp-...
  slack-axi auth workspaces`;

export async function authCommand(args: string[]): Promise<string> {
  if (args.includes("--help") || args.length === 0) return AUTH_HELP;

  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "setup":
      return setup(rest);
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

function setup(args: string[]): string {
  let rest = args;
  const reset = takeBool(rest, "--reset");
  rest = reset.rest;
  if (reset.present) resetSetup();

  const showManifest = takeBool(rest, "--show-manifest");
  rest = showManifest.rest;

  const nameFlag = takeFlag(rest, "--name");
  rest = nameFlag.rest;
  if (nameFlag.value) setAppName(nameFlag.value);

  const confirm = takeFlag(rest, "--confirm-step");
  rest = confirm.rest;
  if (confirm.value) {
    if (confirm.value !== "app_created") {
      throw new AxiError(`Unknown setup step: ${confirm.value}`, "USAGE", [
        "The only manual step is `app_created`",
      ]);
    }
    markAppCreated();
  }

  // Always refresh the generated artifacts so they reflect the current app name + scopes.
  const appName = readSetupState().app_name;
  const manifestFile = writeManifestFile(appName);
  const htmlFile = writeSetupHtmlFile(appName);

  const progress = setupProgress();
  const head = encodeBlock("setup", {
    progress: `${progress.done} of ${progress.total} steps complete`,
    ...(progress.complete ? { status: "complete" } : { next_step: progress.next }),
  });

  let help: string[];
  let blocks: Array<string | undefined> = [head];

  if (progress.next === "app_created") {
    blocks.push(
      encodeBlock("files", {
        manifest: collapseHome(manifestFile),
        setup_page: collapseHome(htmlFile),
      }),
    );
    help = [
      `Open ${collapseHome(htmlFile)} (or ${NEW_APP_URL}) → "From an app manifest" → pick your workspace → paste the manifest from ${collapseHome(manifestFile)}`,
      "Token rotation is disabled in the manifest, so the resulting token won't expire",
      "Once the app exists, run `slack-axi auth setup --confirm-step app_created`",
    ];
  } else if (progress.next === "token_stored") {
    help = [
      'On the app\'s "OAuth & Permissions" page, click "Install to Workspace" and authorize',
      "Copy the User OAuth Token (xoxp-...) and run `slack-axi auth login --token xoxp-...`",
    ];
  } else {
    help = [
      "Run `slack-axi doctor` to verify scopes + read access",
      "To set up another workspace, run `slack-axi auth setup --reset`",
    ];
  }

  if (showManifest.present) blocks.push(`manifest_yaml: |\n${indent(buildManifest(appName), 2)}`);
  blocks.push(renderHelp(help));
  return joinBlocks(...blocks);
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
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
      ? renderHelp([
          `Add missing scopes (${missing.join(", ")}) via \`slack-axi auth setup\`, then re-install + re-login`,
        ])
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
      `Authenticated: ${
        listWorkspaces()
          .map((w) => w.team_id)
          .join(", ") || "(none)"
      }`,
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
