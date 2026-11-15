import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No network: `auth login` validates the token through this one function.
vi.mock("../src/slack/client.js", () => ({
  validateToken: vi.fn(async () => ({
    teamId: "T0ACME001",
    teamName: "Acme",
    userId: "U0MEMBER1",
    userName: "member",
    scopes: [],
  })),
  webClient: vi.fn(),
}));

import { authCommand, AUTH_HELP, login, loginToken } from "../src/commands/auth.js";
import { loginCommand } from "../src/hints.js";
import { validateToken } from "../src/slack/client.js";

const neverRead = () => {
  throw new Error("stdin must not be read unless --token-stdin is given");
};

describe("loginToken — where the token comes from", () => {
  it("--token-stdin reads stdin and trims it", () => {
    const io = { readStdin: () => "xoxp-piped\n", env: { SLACK_AXI_TOKEN: "xoxp-env" } };
    expect(loginToken({ stdin: true }, io)).toBe("xoxp-piped");
  });
  it("--token still works, and never touches stdin", () => {
    expect(
      loginToken({ token: "xoxp-argv", stdin: false }, { readStdin: neverRead, env: {} }),
    ).toBe("xoxp-argv");
  });
  it("falls back to SLACK_AXI_TOKEN when neither flag is given", () => {
    const io = { readStdin: neverRead, env: { SLACK_AXI_TOKEN: "xoxp-env" } };
    expect(loginToken({ stdin: false }, io)).toBe("xoxp-env");
  });
  it("refuses both flags together", () => {
    const io = { readStdin: () => "xoxp-piped", env: {} };
    expect(() => loginToken({ token: "xoxp-argv", stdin: true }, io)).toThrow(
      expect.objectContaining({ code: "USAGE" }),
    );
  });
  it("refuses an empty stdin, with the pipe in the hint", () => {
    try {
      loginToken({ stdin: true }, { readStdin: () => "  \n", env: {} });
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toMatchObject({ code: "USAGE" });
      expect((e as { suggestions: string[] }).suggestions[0]).toContain(loginCommand());
    }
  });
  it("with no token anywhere, shows the read -rs pipe and the environment form", () => {
    try {
      loginToken({ stdin: false }, { readStdin: neverRead, env: {} });
      throw new Error("expected a throw");
    } catch (e) {
      const err = e as { code: string; suggestions: string[] };
      expect(err.code).toBe("USAGE");
      expect(err.suggestions[0]).toContain(
        'read -rs T && printf %s "$T" | slack-axi auth login --token-stdin',
      );
      expect(err.suggestions[1]).toContain("SLACK_AXI_TOKEN");
    }
  });
});

describe("auth login", () => {
  let dir: string;
  let savedDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slack-axi-auth-"));
    savedDir = process.env.SLACK_AXI_CONFIG_DIR;
    process.env.SLACK_AXI_CONFIG_DIR = dir;
    vi.mocked(validateToken).mockClear();
  });
  afterEach(() => {
    if (savedDir === undefined) delete process.env.SLACK_AXI_CONFIG_DIR;
    else process.env.SLACK_AXI_CONFIG_DIR = savedDir;
    rmSync(dir, { recursive: true, force: true });
  });

  const stored = () =>
    JSON.parse(readFileSync(join(dir, "workspaces", "T0ACME001", "token.json"), "utf-8")) as {
      token: string;
    };

  it("stores the token piped on stdin, and never echoes it", async () => {
    const out = await login(["--token-stdin"], { readStdin: () => "xoxp-piped\n", env: {} });
    expect(validateToken).toHaveBeenCalledWith("xoxp-piped");
    expect(stored().token).toBe("xoxp-piped");
    expect(out).toContain("workspace: Acme (T0ACME001)");
    expect(out).not.toContain("xoxp-piped");
  });
  it("stores a --token value", async () => {
    await login(["--token", "xoxp-argv"], { readStdin: neverRead, env: {} });
    expect(stored().token).toBe("xoxp-argv");
  });
  it("stores the SLACK_AXI_TOKEN token when no flag is given", async () => {
    await login([], { readStdin: neverRead, env: { SLACK_AXI_TOKEN: "xoxp-env" } });
    expect(stored().token).toBe("xoxp-env");
  });
  it("refuses an unknown flag, a stray argument, and no token, before validating anything", async () => {
    const io = { readStdin: neverRead, env: {} };
    await expect(login(["--tokne", "x"], io)).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
    await expect(login(["xoxp-positional"], io)).rejects.toMatchObject({ code: "USAGE" });
    await expect(login([], io)).rejects.toMatchObject({ code: "USAGE" });
    expect(validateToken).not.toHaveBeenCalled();
  });
  it("documents stdin and the environment variable as the default", () => {
    expect(AUTH_HELP).toContain("--token-stdin");
    expect(AUTH_HELP).toContain("SLACK_AXI_TOKEN");
    expect(AUTH_HELP).toContain(loginCommand());
  });
});

describe("auth use / revoke", () => {
  let dir: string;
  let savedDir: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slack-axi-auth-"));
    savedDir = process.env.SLACK_AXI_CONFIG_DIR;
    process.env.SLACK_AXI_CONFIG_DIR = dir;
  });
  afterEach(() => {
    if (savedDir === undefined) delete process.env.SLACK_AXI_CONFIG_DIR;
    else process.env.SLACK_AXI_CONFIG_DIR = savedDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("take the workspace as an argument or as --team, and refuse a second argument", async () => {
    expect(await authCommand(["revoke", "T0ACME001"])).toContain("T0ACME001 (was not stored");
    expect(await authCommand(["revoke", "--team", "T0ACME001"])).toContain("T0ACME001");
    await expect(authCommand(["revoke", "T0ACME001", "T0ACME002"])).rejects.toMatchObject({
      code: "USAGE",
    });
    await expect(authCommand(["use"])).rejects.toMatchObject({ code: "USAGE" });
    await expect(authCommand(["workspaces", "--team", "T0ACME001"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
  });
});
