import { resolveActiveToken } from "../config.js";
import { takeFlag } from "../flags.js";
import { encodeBlock, joinBlocks, renderHelp, renderList } from "../output.js";
import { validateToken, webClient } from "../slack/client.js";
import { toAxiError } from "../slack/errors.js";
import { missingScopes } from "../slack/scopes.js";

export const DOCTOR_HELP = `usage: slack-axi doctor [--team <id>]
Checks the active workspace's token, scope coverage, and read access.
Exit 1 if any check fails; warnings (e.g. a missing scope) keep exit 0.`;

export async function doctorCommand(args: string[]): Promise<string> {
  if (args.includes("--help")) return DOCTOR_HELP;
  const { value: teamFlag } = takeFlag(args, "--team");

  const active = resolveActiveToken({ teamFlag });
  const checks: Array<Record<string, unknown>> = [];

  // 1. Token validity (hard fail → exit 1).
  let identity;
  try {
    identity = await validateToken(active.token);
  } catch (err) {
    throw toAxiError(err, teamFlag ? { team: teamFlag } : {});
  }
  checks.push({ check: "token", status: "ok", detail: "auth.test passed" });

  // 2. Scope coverage (missing → warn, exit 0).
  const missing = missingScopes(identity.scopes);
  checks.push({
    check: "scopes",
    status: missing.length === 0 ? "ok" : "warn",
    detail: missing.length === 0 ? "all required granted" : `missing ${missing.join(", ")}`,
  });

  // 3. Read probe (hard fail → exit 1).
  try {
    await webClient(active.token).users.conversations({ limit: 1 });
    checks.push({ check: "read_probe", status: "ok", detail: "users.conversations reachable" });
  } catch (err) {
    throw toAxiError(err, teamFlag ? { team: teamFlag } : {});
  }

  const header = encodeBlock(
    "workspace",
    `${identity.teamName} (${identity.teamId}) as ${identity.userName ?? identity.userId}`,
  );
  const help =
    missing.length > 0
      ? renderHelp([`Add missing scopes via \`slack-axi auth setup\`, then re-install + re-login`])
      : "";
  return joinBlocks(header, renderList("checks", checks), help);
}
