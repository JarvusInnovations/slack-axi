import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatError, main } from "../src/cli.js";

describe("formatError", () => {
  it.each(["USAGE", "UNKNOWN_FLAG", "VALIDATION_ERROR"])("%s exits 2", (code) => {
    const { output, exitCode } = formatError(new AxiError("bad call", code, ["Run `x`"]));
    expect(exitCode).toBe(2);
    expect(output).toBe(`error: bad call\ncode: ${code}\nhelp[1]:\n  Run \`x\`\n`);
  });
  it.each(["NO_TOKEN", "CHANNEL_NOT_FOUND", "SLACK_ERROR"])("%s exits 1", (code) => {
    expect(formatError(new AxiError("failed", code, [])).exitCode).toBe(1);
  });
  it("wraps anything unexpected as INTERNAL_ERROR with a doctor hint, and no stack", () => {
    const { output, exitCode } = formatError(new TypeError("x is not a function"));
    expect(exitCode).toBe(1);
    expect(output).toContain("unexpected failure: x is not a function");
    expect(output).toContain("code: INTERNAL_ERROR");
    expect(output).toContain("slack-axi doctor");
    expect(output).not.toMatch(/\n\s+at /);
    expect(formatError("boom").output).toContain("unexpected failure: boom");
  });
});

/** Run the CLI in-process against an empty temp config, capturing stdout and the exit code. */
describe("the CLI exits 2 on a malformed invocation", () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["SLACK_AXI_CONFIG_DIR", "SLACK_AXI_TOKEN", "SLACK_AXI_TEAM", "HOME"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slack-axi-cli-"));
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.SLACK_AXI_CONFIG_DIR = join(dir, "config");
    process.env.HOME = dir;
    delete process.env.SLACK_AXI_TOKEN;
    delete process.env.SLACK_AXI_TEAM;
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(...argv: string[]): Promise<{ out: string; code: number }> {
    let out = "";
    const before = process.exitCode;
    try {
      await main(argv, { write: (chunk: string) => ((out += chunk), true) });
      return { out, code: Number(process.exitCode ?? 0) };
    } finally {
      // The SDK reports failure through process.exitCode; don't let it fail the test run.
      process.exitCode = before;
    }
  }

  it("an unknown flag", async () => {
    const { out, code } = await run("read", "#eng", "--sinse", "7d");
    expect(code).toBe(2);
    expect(out).toBe(
      "error: unknown flag --sinse for `read`\ncode: UNKNOWN_FLAG\nhelp[1]:\n" +
        "  valid flags for `read`: --cite, --exclude-bots, --from, --full, --limit, --since, --threads, --to, --tz (--help and --team always allowed)\n",
    );
  });
  it("a missing argument, an extra argument, and a value flag without its value", async () => {
    expect((await run("thread", "#eng")).code).toBe(2);
    expect((await run("reactions", "#eng", "1717589640123456", "extra")).code).toBe(2);
    expect((await run("read", "#eng", "--since")).code).toBe(2);
  });
  it("an unknown --fields name, before any Slack call", async () => {
    const { out, code } = await run("channels", "--fields", "topic,unread");
    expect(code).toBe(2);
    expect(out).toContain("code: VALIDATION_ERROR");
    expect(out).toContain("valid --fields for `channels`: is_member, topic, purpose");
  });
  it("`setup hooks --bogus` is refused before anything is installed", async () => {
    const { out, code } = await run("setup", "hooks", "--bogus");
    expect(code).toBe(2);
    expect(out).toContain("`setup hooks` takes no flags (--help always allowed)");
  });
  it("a well-formed call with no token is an operation failure: exit 1", async () => {
    const { out, code } = await run("channels", "--fields", "topic");
    expect(code).toBe(1);
    expect(out).toContain("code: NO_TOKEN");
    expect(out).toContain("--token-stdin");
  });
});
