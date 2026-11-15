import { AxiError } from "axi-sdk-js";
import {
  getDefaultTeam,
  getStoredToken,
  isMode,
  isBotToken,
  listWorkspaces,
  removeWorkspace,
  resolveActiveToken,
  setDefaultTeam,
  setWorkspaceMode,
  workspaceMode,
  writeStoredToken,
} from "../config.js";
import { readFileSync } from "node:fs";
import { bool, parseCommand, str, usageError } from "../flags.js";
import { loginCommand, loginHint } from "../hints.js";
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
import { addScopesHelp, missingScopes } from "../slack/scopes.js";

export const AUTH_HELP = `usage: slack-axi auth <subcommand> [flags]
subcommands[6]:
  setup                    Progressive guided setup: create an app from a manifest, then log in
  login --token-stdin      Validate and store a token read from stdin (derives team/user/scopes/mode)
  workspaces               List authenticated workspaces (default marked)
  use <team>               Set the default workspace
  mode [human|bot|auto]    Show or set how outgoing text is rendered (mrkdwn text vs Block Kit; auto = derive)
  revoke <team>            Delete a workspace's stored token
setup flags[4]:
  --name <name>            App display name in the manifest (default: slack-axi)
  --confirm-step <step>    Mark a manual step done (step: app_created)
  --show-manifest          Also print the manifest YAML inline
  --reset                  Clear setup state (e.g. to set up another workspace)
login flags[2]:
  --token-stdin            Read the token from stdin (keeps it out of shell history and the process list)
  --token <xoxp-...>       Pass the token as an argument instead (it will be visible in both)
  With neither flag, login stores the token found in the SLACK_AXI_TOKEN environment variable.
flags[1]:
  --team <id>              Target a specific workspace (setup/login/mode/use/revoke)
examples:
  slack-axi auth setup
  slack-axi auth setup --confirm-step app_created
  ${loginCommand()}
  SLACK_AXI_TOKEN=xoxp-... slack-axi auth login
  slack-axi auth workspaces`;

export async function authCommand(args: string[]): Promise<string> {
  if (args.includes("--help") || args.length === 0) return AUTH_HELP;

  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "setup":
      return await setup(rest);
    case "login":
      return login(rest);
    case "workspaces":
      return workspaces(rest);
    case "use":
      return use(rest);
    case "mode":
      return mode(rest);
    case "revoke":
      return revoke(rest);
    default:
      throw new AxiError(`Unknown auth subcommand: ${sub}`, "USAGE", [
        "Subcommands: setup, login, workspaces, use, mode, revoke",
      ]);
  }
}

/** Show or set a workspace's outgoing-rendering mode. See specs/behaviors/mrkdwn.md. */
function mode(args: string[]): string {
  const parsed = parseCommand("auth mode", args);
  const value = parsed.positional[0];
  const teamId = str(parsed, "--team") ?? resolveActiveToken({}).teamId;
  if (!teamId) {
    throw new AxiError("No stored workspace to set a mode on", "TEAM_REQUIRED", [
      "Pass --team <id>, or set SLACK_AXI_MODE=human|bot for an env-token run",
    ]);
  }
  const stored = getStoredToken(teamId);
  if (!stored) {
    throw new AxiError(`Workspace ${teamId} is not authenticated`, "TEAM_NOT_FOUND", [
      `Authenticated: ${
        listWorkspaces()
          .map((w) => w.team_id)
          .join(", ") || "(none)"
      }`,
    ]);
  }
  const workspace = `${stored.team_name} (${stored.team_id})`;
  if (!value) {
    return encodeBlock("mode", {
      workspace,
      mode: workspaceMode(stored),
      source: stored.mode
        ? "set with `auth mode`"
        : `derived from the token (${isBotToken(stored) ? "bot" : "user"})`,
    });
  }
  if (value === "auto") {
    if (!stored.mode) {
      return encodeBlock("mode", {
        workspace,
        mode: workspaceMode(stored),
        note: "already derived (no-op)",
      });
    }
    setWorkspaceMode(teamId, undefined);
    const cleared = getStoredToken(teamId);
    return encodeBlock("mode", {
      workspace,
      mode: cleared ? workspaceMode(cleared) : "human",
      source: "derived from the token (override cleared)",
    });
  }
  if (!isMode(value)) {
    throw new AxiError(`Unknown mode '${value}'`, "USAGE", ["Use: human | bot | auto"]);
  }
  if (stored.mode === value) {
    return encodeBlock("mode", { workspace, mode: value, note: "already set (no-op)" });
  }
  setWorkspaceMode(teamId, value);
  return encodeBlock("mode", { workspace, mode: value, source: "set with `auth mode`" });
}

/**
 * Granted-scope gap for the active workspace, checked live via `auth.test` (Slack keeps the token
 * across a scope-adding reinstall, so stored scopes go stale). Undefined when no token resolves or the
 * check fails — setup must not fail on a network hiccup.
 */
async function liveScopeGap(
  teamFlag?: string,
): Promise<{ team: string; missing: string[] } | undefined> {
  try {
    const active = resolveActiveToken({ teamFlag });
    const identity = await validateToken(active.token);
    return {
      team: `${identity.teamName} (${identity.teamId})`,
      missing: missingScopes(identity.scopes),
    };
  } catch {
    return undefined;
  }
}

async function setup(args: string[]): Promise<string> {
  // Parse and validate everything before any state is touched.
  const parsed = parseCommand("auth setup", args);
  const teamFlag = str(parsed, "--team");
  const showManifest = bool(parsed, "--show-manifest");
  const confirm = str(parsed, "--confirm-step");
  if (confirm !== undefined && confirm !== "app_created") {
    throw new AxiError(`Unknown setup step: ${confirm}`, "USAGE", [
      "The only manual step is `app_created`",
    ]);
  }

  if (bool(parsed, "--reset")) resetSetup();
  const name = str(parsed, "--name");
  if (name) setAppName(name);
  if (confirm) markAppCreated();

  // Always refresh the generated artifacts so they reflect the current app name + scopes.
  const appName = readSetupState().app_name;
  const manifestFile = writeManifestFile(appName);
  const htmlFile = writeSetupHtmlFile(appName);

  const progress = setupProgress();
  // A finished setup can still fall behind: a release that adds a required scope leaves the existing
  // app without it. Check live so setup says so instead of a bare "complete". See specs/commands/auth.md.
  const gap = progress.complete ? await liveScopeGap(teamFlag) : undefined;
  const behind = gap !== undefined && gap.missing.length > 0;
  const head = encodeBlock("setup", {
    progress: `${progress.done} of ${progress.total} steps complete`,
    ...(progress.complete
      ? behind
        ? {
            status: "complete, but the app is missing scopes",
            workspace: gap.team,
            missing_scopes: gap.missing.join(", "),
          }
        : { status: "complete" }
      : { next_step: progress.next }),
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
      `Copy the User OAuth Token (xoxp-...), then run \`${loginCommand()}\` and paste it at the silent prompt`,
    ];
  } else if (behind) {
    blocks.push(encodeBlock("files", { manifest: collapseHome(manifestFile) }));
    help = [
      ...addScopesHelp(gap.missing),
      `Or paste the updated manifest from ${collapseHome(manifestFile)} on the app's App Manifest page, then reinstall`,
    ];
  } else {
    help = [
      "Run `slack-axi doctor` to verify scopes + read access",
      "To set up another workspace, run `slack-axi auth setup --reset`",
    ];
  }

  if (showManifest) blocks.push(`manifest_yaml: |\n${indent(buildManifest(appName), 2)}`);
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

/** Read all of stdin. Only called when `--token-stdin` asks for it, so login never blocks on a terminal. */
function readStdin(): string {
  return readFileSync(0, "utf-8");
}

/**
 * The token for `auth login`, from exactly one place: `--token-stdin`, then `--token`, then the
 * `SLACK_AXI_TOKEN` environment variable. See specs/commands/auth.md.
 */
export function loginToken(
  flags: { token?: string; stdin: boolean },
  io: { readStdin: () => string; env: Record<string, string | undefined> },
): string {
  if (flags.token !== undefined && flags.stdin) {
    throw new AxiError("--token and --token-stdin are mutually exclusive", "USAGE", [
      "Pass only `--token-stdin` and pipe the token in",
    ]);
  }
  if (flags.stdin) {
    const piped = io.readStdin().trim();
    if (piped.length === 0) {
      throw new AxiError("--token-stdin was given but stdin carried no token", "USAGE", [
        loginHint(),
      ]);
    }
    return piped;
  }
  if (flags.token !== undefined) return flags.token;
  const env = io.env.SLACK_AXI_TOKEN?.trim();
  if (env) return env;
  throw new AxiError("No token given", "USAGE", [
    loginHint(),
    "Or set SLACK_AXI_TOKEN in the environment and run `slack-axi auth login`",
    "Run `slack-axi auth setup` to create a Slack app and obtain a token",
  ]);
}

export async function login(
  args: string[],
  io: { readStdin: () => string; env: Record<string, string | undefined> } = {
    readStdin,
    env: process.env,
  },
): Promise<string> {
  const parsed = parseCommand("auth login", args);
  const teamFlag = str(parsed, "--team");
  const token = loginToken(
    { token: str(parsed, "--token"), stdin: bool(parsed, "--token-stdin") },
    io,
  );

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
    ...(identity.botId ? { bot_id: identity.botId } : {}),
    user_name: identity.userName,
    token,
    scopes: identity.scopes,
    obtained_at: new Date().toISOString(),
  });

  const missing = missingScopes(identity.scopes);
  const summary = encodeBlock("authenticated", {
    workspace: `${identity.teamName} (${identity.teamId})`,
    user: identity.userName ? `${identity.userName} (${identity.userId})` : identity.userId,
    ...(identity.botId ? { bot: identity.botId } : {}),
    mode: identity.botId ? "bot (Block Kit)" : "human (mrkdwn text)",
    scopes: missing.length === 0 ? "all required scopes granted" : `missing ${missing.length}`,
    default: getDefaultTeam() === identity.teamId,
  });

  const help = missing.length > 0 ? renderHelp(addScopesHelp(missing)) : "";
  return joinBlocks(summary, help);
}

function workspaces(args: string[]): string {
  parseCommand("auth workspaces", args);
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
    mode: workspaceMode(w),
    default: w.team_id === def,
  }));
  return joinBlocks(
    renderList("workspaces", rows),
    renderHelp(["Run `slack-axi auth use <team>` to change the default"]),
  );
}

function use(args: string[]): string {
  const team = teamArgument("auth use", args);
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
  const team = teamArgument("auth revoke", args);
  const existed = removeWorkspace(team);
  return encodeBlock("revoked", existed ? team : `${team} (was not stored — no-op)`);
}

/** The workspace `use`/`revoke` act on: the positional, or `--team <id>` (both spellings are documented). */
function teamArgument(command: "auth use" | "auth revoke", args: string[]): string {
  const parsed = parseCommand(command, args);
  const positional = parsed.positional[0];
  const flag = str(parsed, "--team");
  if (positional && flag && positional !== flag) {
    throw new AxiError(
      `Two different workspaces given: ${positional} and --team ${flag}`,
      "USAGE",
      [`Pass one: \`slack-axi ${command} ${positional}\``],
    );
  }
  const team = positional ?? flag;
  if (!team) throw usageError(command);
  return team;
}
