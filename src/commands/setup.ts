import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { encodeBlock, joinBlocks, renderHelp } from "../output.js";

export const SETUP_HELP = `usage: slack-axi setup hooks
Install or repair agent SessionStart hooks so each session starts with slack-axi's home view
(workspace + channel count) as ambient context. Idempotent; repairs a stale executable path.
examples:
  slack-axi setup hooks`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return SETUP_HELP;
  if (args[0] !== "hooks") {
    throw new AxiError(`Unknown setup action: ${args[0] ?? "(none)"}`, "USAGE", ["Run `slack-axi setup hooks`"]);
  }

  const errors: string[] = [];
  installSessionStartHooks({ marker: "slack-axi", timeoutSeconds: 10, onError: (m) => errors.push(m) });
  if (errors.length > 0) {
    throw new AxiError("Hook installation reported problems", "HOOK_INSTALL_FAILED", errors);
  }

  return joinBlocks(
    encodeBlock("hooks", { status: "installed", integrations: "Claude Code, Codex, OpenCode", marker: "slack-axi" }),
    renderHelp(["Restart your agent session to receive slack-axi ambient context"]),
  );
}
