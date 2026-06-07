import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  listWorkspaceIds,
  manifestPath,
  setupHtmlPath,
  setupStatePath,
} from "../config.js";
import { REQUIRED_SCOPES } from "../slack/scopes.js";

/** Where to start "Create an app from a manifest". */
export const NEW_APP_URL = "https://api.slack.com/apps?new_app=1";

interface StepState {
  done: boolean;
  at?: string;
}

interface SetupState {
  version: number;
  app_name: string;
  steps: {
    app_created: StepState;
  };
}

const DEFAULT_APP_NAME = "slack-axi";

function defaultState(): SetupState {
  return { version: 1, app_name: DEFAULT_APP_NAME, steps: { app_created: { done: false } } };
}

export function readSetupState(): SetupState {
  if (!existsSync(setupStatePath())) return defaultState();
  try {
    const parsed = JSON.parse(readFileSync(setupStatePath(), "utf-8")) as Partial<SetupState>;
    return {
      version: parsed.version ?? 1,
      app_name: parsed.app_name ?? DEFAULT_APP_NAME,
      steps: { app_created: parsed.steps?.app_created ?? { done: false } },
    };
  } catch {
    return defaultState();
  }
}

function writeState(state: SetupState): void {
  mkdirSync(dirname(setupStatePath()), { recursive: true });
  writeFileSync(setupStatePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export function markAppCreated(): void {
  const state = readSetupState();
  state.steps.app_created = { done: true, at: new Date().toISOString() };
  writeState(state);
}

export function resetSetup(): void {
  writeState(defaultState());
}

export function setAppName(name: string): void {
  const state = readSetupState();
  state.app_name = name;
  writeState(state);
}

export interface SetupProgress {
  appCreated: boolean;
  tokenStored: boolean;
  done: number;
  total: number;
  complete: boolean;
  /** The next incomplete step key, or undefined when complete. */
  next?: "app_created" | "token_stored";
}

/**
 * token_stored is derived from a successful `auth login` (a stored workspace), never confirmed
 * manually. A stored token is proof the app was created and installed, so it subsumes the
 * app_created waypoint: once a token exists, setup is complete regardless of the manual confirm.
 */
export function setupProgress(): SetupProgress {
  const appCreated = readSetupState().steps.app_created.done;
  const tokenStored = listWorkspaceIds().length > 0;
  if (tokenStored) {
    return { appCreated: true, tokenStored, done: 2, total: 2, complete: true, next: undefined };
  }
  const done = appCreated ? 1 : 0;
  return { appCreated, tokenStored, done, total: 2, complete: false, next: appCreated ? "token_stored" : "app_created" };
}

/** Build a Slack app manifest (YAML) pre-filled with the user-token scopes slack-axi needs. */
export function buildManifest(appName: string): string {
  const scopeLines = REQUIRED_SCOPES.map((s) => `      - ${s}`).join("\n");
  return `display_information:
  name: ${appName}
  description: Agent-ergonomic Slack CLI — read, search, and draft
oauth_config:
  scopes:
    user:
${scopeLines}
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
`;
}

/** Write the manifest YAML to the config dir; returns its path. */
export function writeManifestFile(appName: string): string {
  const path = manifestPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildManifest(appName));
  return path;
}

/** Write a local setup.html with the new-app link and a copy-paste manifest box; returns its path. */
export function writeSetupHtmlFile(appName: string): string {
  const path = setupHtmlPath();
  const manifest = buildManifest(appName);
  const escaped = manifest.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>slack-axi setup</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  ol { padding-left: 1.2rem; } li { margin: 0.6rem 0; }
  a.btn { display: inline-block; background: #4a154b; color: #fff; padding: 0.5rem 0.9rem; border-radius: 6px; text-decoration: none; }
  textarea { width: 100%; height: 22rem; font-family: ui-monospace, monospace; font-size: 13px; }
  code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 4px; }
  button { font: inherit; padding: 0.35rem 0.7rem; }
</style>
</head>
<body>
<h1>slack-axi setup</h1>
<ol>
  <li><a class="btn" href="${NEW_APP_URL}" target="_blank" rel="noopener">Create a Slack app</a> — choose <strong>“From an app manifest”</strong>, pick your workspace.</li>
  <li>Paste this manifest (all user-token scopes pre-filled; token rotation disabled):
    <p><button onclick="navigator.clipboard.writeText(document.getElementById('m').value)">Copy manifest</button></p>
    <textarea id="m" readonly>${escaped}</textarea>
  </li>
  <li>On the app’s <strong>OAuth &amp; Permissions</strong> page, click <strong>Install to Workspace</strong> and authorize.</li>
  <li>Copy the <strong>User OAuth Token</strong> (<code>xoxp-…</code>) and run:<br>
    <code>slack-axi auth login --token xoxp-…</code></li>
</ol>
</body>
</html>
`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return path;
}
