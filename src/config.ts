import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AxiError } from "axi-sdk-js";

/** A stored user token for one workspace (team). Written at `auth login`. */
export interface StoredToken {
  team_id: string;
  team_name: string;
  user_id: string;
  user_name?: string;
  token: string;
  scopes: string[];
  obtained_at: string;
}

export interface UserConfig {
  default_team?: string;
}

/** Result of resolving which token/workspace a command should act against. */
export interface ActiveToken {
  token: string;
  teamId: string | undefined;
  teamName: string | undefined;
  scopes: string[] | undefined;
  source: "env" | "flag" | "default" | "single";
}

/** Base config directory: $SLACK_AXI_CONFIG_DIR, else $XDG_CONFIG_HOME/slack-axi, else ~/.config/slack-axi. */
export function configDir(): string {
  if (process.env.SLACK_AXI_CONFIG_DIR) return process.env.SLACK_AXI_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "slack-axi");
}

export function userConfigPath(): string {
  return join(configDir(), "config.json");
}

export function setupStatePath(): string {
  return join(configDir(), "setup.json");
}

export function manifestPath(): string {
  return join(configDir(), "manifest.yaml");
}

export function setupHtmlPath(): string {
  return join(configDir(), "setup.html");
}

export function workspaceDir(teamId: string): string {
  return join(configDir(), "workspaces", teamId);
}

export function tokenPath(teamId: string): string {
  return join(workspaceDir(teamId), "token.json");
}

export function cacheChannelsPath(teamId: string): string {
  return join(configDir(), "cache", teamId, "channels.json");
}

export function cacheUsersPath(teamId: string): string {
  return join(configDir(), "cache", teamId, "users.json");
}

/** A locally-stored message draft (prepare→approve; never auto-sent). */
export interface Draft {
  id: string;
  team: string;
  channel_id: string;
  channel: string;
  reply_to?: string;
  text: string;
  created_at: string;
  sent?: { ts: string; permalink: string; at: string };
}

function draftsDir(): string {
  return join(configDir(), "drafts");
}

function draftPath(id: string): string {
  return join(draftsDir(), `${id}.json`);
}

export function getDraft(id: string): Draft | undefined {
  return readJson<Draft>(draftPath(id));
}

export function writeDraft(draft: Draft): void {
  writeJson(draftPath(draft.id), draft);
}

export function removeDraft(id: string): boolean {
  if (!existsSync(draftPath(id))) return false;
  rmSync(draftPath(id), { force: true });
  return true;
}

export function listDrafts(): Draft[] {
  const dir = draftsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Draft>(join(dir, f)))
    .filter((d): d is Draft => d !== undefined)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
}

export function readUserConfig(): UserConfig {
  return readJson<UserConfig>(userConfigPath()) ?? {};
}

export function writeUserConfig(config: UserConfig): void {
  writeJson(userConfigPath(), config);
}

export function getDefaultTeam(): string | undefined {
  return readUserConfig().default_team;
}

export function setDefaultTeam(teamId: string): void {
  writeUserConfig({ ...readUserConfig(), default_team: teamId });
}

/** Team ids with a stored token, in directory order. */
export function listWorkspaceIds(): string[] {
  const dir = join(configDir(), "workspaces");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(tokenPath(entry.name)))
    .map((entry) => entry.name);
}

export function listWorkspaces(): StoredToken[] {
  return listWorkspaceIds()
    .map((id) => readJson<StoredToken>(tokenPath(id)))
    .filter((t): t is StoredToken => t !== undefined);
}

export function getStoredToken(teamId: string): StoredToken | undefined {
  return readJson<StoredToken>(tokenPath(teamId));
}

/** Persist a token (mode 0600); first stored workspace becomes the default. */
export function writeStoredToken(token: StoredToken): void {
  writeJson(tokenPath(token.team_id), token, 0o600);
  if (getDefaultTeam() === undefined) setDefaultTeam(token.team_id);
}

/** Delete a workspace's stored token + dir. Idempotent. Repairs a dangling default. */
export function removeWorkspace(teamId: string): boolean {
  const dir = workspaceDir(teamId);
  const existed = existsSync(tokenPath(teamId));
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  if (getDefaultTeam() === teamId) {
    const remaining = listWorkspaceIds();
    const config = readUserConfig();
    if (remaining.length > 0) config.default_team = remaining[0];
    else delete config.default_team;
    writeUserConfig(config);
  }
  return existed;
}

/**
 * Resolve which token/workspace a command should act against, per
 * specs/behaviors/auth-and-workspaces.md. Order: env → --team → default → single → error.
 * Mutations with 2+ stored workspaces require an explicit team (env or flag).
 */
export function resolveActiveToken(options: {
  teamFlag?: string;
  mutation?: boolean;
}): ActiveToken {
  const { teamFlag, mutation = false } = options;

  const envToken = process.env.SLACK_AXI_TOKEN;
  if (envToken && envToken.length > 0) {
    const envTeam = process.env.SLACK_AXI_TEAM ?? teamFlag;
    const stored = envTeam ? getStoredToken(envTeam) : undefined;
    return {
      token: envToken,
      teamId: envTeam,
      teamName: stored?.team_name,
      scopes: stored?.scopes,
      source: "env",
    };
  }

  const ids = listWorkspaceIds();
  if (ids.length === 0) {
    throw new AxiError(
      "No Slack token available",
      "NO_TOKEN",
      [
        "Set SLACK_AXI_TOKEN, or run `slack-axi auth setup` to create an app and store a token",
        "Then `slack-axi auth login --token xoxp-...`",
      ],
    );
  }

  if (teamFlag) return fromStored(teamFlag, "flag");

  if (mutation && ids.length > 1) {
    throw new AxiError(
      "Multiple workspaces are stored; a mutation requires an explicit workspace",
      "TEAM_REQUIRED",
      [
        `Pass --team <id> (one of: ${ids.join(", ")}) or set SLACK_AXI_TEAM`,
      ],
    );
  }

  const def = getDefaultTeam();
  if (def && getStoredToken(def)) return fromStored(def, "default");
  if (ids.length === 1) return fromStored(ids[0], "single");

  throw new AxiError(
    "No default workspace set and multiple are stored",
    "NO_DEFAULT_TEAM",
    [`Run \`slack-axi auth use <team>\` (one of: ${ids.join(", ")})`],
  );
}

function fromStored(teamId: string, source: ActiveToken["source"]): ActiveToken {
  const stored = getStoredToken(teamId);
  if (!stored) {
    throw new AxiError(
      `Workspace ${teamId} is not authenticated`,
      "TEAM_NOT_FOUND",
      [`Authenticated workspaces: ${listWorkspaceIds().join(", ") || "(none)"}`],
    );
  }
  return {
    token: stored.token,
    teamId: stored.team_id,
    teamName: stored.team_name,
    scopes: stored.scopes,
    source,
  };
}
