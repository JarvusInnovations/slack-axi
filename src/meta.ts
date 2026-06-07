import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DESCRIPTION = "Read, search, and draft Slack across your workspaces";

/** Read the package version from the nearest package.json (dist or src layout). */
export function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  }
  return "0.0.0";
}
