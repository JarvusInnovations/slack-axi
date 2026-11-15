import { describe, expect, it } from "vitest";
import { COMMAND_HELP } from "../src/cli.js";
import {
  type CommandName,
  declaredFlags,
  FLAG_SPECS,
  type FlagSpec,
  isLongFlag,
  multiStr,
  parseCommand,
  parseFields,
  parseFlags,
  str,
} from "../src/flags.js";

const errorOf = (fn: () => unknown): { code: string; message: string; suggestions: string[] } => {
  try {
    fn();
  } catch (e) {
    return e as { code: string; message: string; suggestions: string[] };
  }
  throw new Error("expected a throw");
};

describe("value flags without a value", () => {
  it("refuses a trailing value flag", () => {
    const err = errorOf(() => parseCommand("draft", ["#eng", "hi", "--reply"]));
    expect(err.code).toBe("USAGE");
    expect(err.message).toMatch(/--reply needs a value/);
  });
  it("refuses to take the next flag as its value", () => {
    expect(errorOf(() => parseCommand("draft", ["#eng", "--reply", "--preview", "hi"])).code).toBe(
      "USAGE",
    );
  });
  it("accepts dash-led values that aren't long flags", () => {
    expect(str(parseCommand("read", ["#eng", "--tz", "-05:00"]), "--tz")).toBe("-05:00");
    const parsed = parseCommand("search", ["--has", "link", "--has", "file"]);
    expect(multiStr(parsed, "--has")).toEqual(["link", "file"]);
  });
  it("accepts --flag=value", () => {
    const parsed = parseCommand("read", ["#eng", "--since=24h", "--team=T1"]);
    expect(str(parsed, "--since")).toBe("24h");
    expect(str(parsed, "--team")).toBe("T1");
  });
  it("leaves an absent flag undefined", () => {
    const parsed = parseCommand("draft", ["#eng", "hi"]);
    expect(str(parsed, "--reply")).toBeUndefined();
    expect(parsed.positional).toEqual(["#eng", "hi"]);
  });
  it("refuses a value flag given twice, and a switch given a value", () => {
    expect(errorOf(() => parseCommand("read", ["#eng", "--limit", "5", "--limit", "9"])).code).toBe(
      "USAGE",
    );
    expect(errorOf(() => parseCommand("read", ["#eng", "--full=yes"])).message).toMatch(
      /--full is a switch/,
    );
  });
});

describe("free text", () => {
  it("keeps dash-led text: list items, rules, exclusions, negatives", () => {
    const args = ["#eng", "- api ok", "---", "-draft", "-5", "--"];
    expect(parseCommand("draft", args).positional).toEqual(args);
    expect(parseCommand("edit", args).positional).toEqual(args);
    expect(parseCommand("search", ["deploy", "-staging"]).positional).toEqual([
      "deploy",
      "-staging",
    ]);
  });
  it("refuses an unknown long flag and lists the command's flags", () => {
    const err = errorOf(() => parseCommand("draft", ["#eng", "hi", "--tema", "T1"]));
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.message).toBe("unknown flag --tema for `draft`");
    expect(err.suggestions).toEqual([
      "valid flags for `draft`: --file, --no-unfurl, --preview, --raw, --reply, --snippet (--help and --team always allowed)",
    ]);
  });
});

describe("positional counting", () => {
  it("refuses more positionals than the command takes", () => {
    const err = errorOf(() => parseCommand("thread", ["#eng", "1717589640123456", "extra"]));
    expect(err.code).toBe("USAGE");
    expect(err.message).toBe("unexpected argument for `thread`: extra");
    expect(err.suggestions[0]).toContain("usage: slack-axi thread <channel> <ts>");
    expect(errorOf(() => parseCommand("channels", ["proj"])).code).toBe("USAGE");
    expect(errorOf(() => parseCommand("react", ["#eng", "1", ":eyes:", ":tada:"])).code).toBe(
      "USAGE",
    );
  });
  it("refuses a short flag where the positionals aren't free text", () => {
    const err = errorOf(() => parseCommand("read", ["#eng", "-n", "5"]));
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.message).toBe("unknown flag -n for `read`");
  });
  it("allows any number where the command is variadic", () => {
    expect(parseCommand("user", ["U1", "U2", "U3"]).positional).toHaveLength(3);
  });
});

describe("refused flags", () => {
  it("shows the targeted hint in place of the list, even when given bare", () => {
    const spec: FlagSpec = { value: ["--to"], deprecated: { "--until": "--until is now --to" } };
    const err = errorOf(() => parseFlags("demo", ["--until"], spec));
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.suggestions).toEqual(["--until is now --to"]);
  });
});

describe("every declared command", () => {
  const entries = Object.entries(FLAG_SPECS) as Array<[CommandName, FlagSpec]>;

  it.each(entries)("`%s --bogus` is UNKNOWN_FLAG naming that command's flags", (name, spec) => {
    const err = errorOf(() => parseCommand(name, ["--bogus"]));
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.message).toBe(`unknown flag --bogus for \`${name}\``);
    const hint = err.suggestions[0];
    for (const flag of declaredFlags(spec)) expect(hint).toContain(flag);
    // The message never advertises --team from a command that would refuse it.
    expect(hint.includes("--team")).toBe(spec.team !== false);
    expect(hint).toContain("--help");
  });

  it.each(entries)("`%s` documents every declared flag in its --help", (name, spec) => {
    const help = COMMAND_HELP[name.split(" ")[0]];
    expect(help).toBeDefined();
    for (const flag of declaredFlags(spec)) expect(help).toContain(flag);
  });

  it("--team is refused only where no workspace is resolved", () => {
    expect(str(parseCommand("doctor", ["--team", "T1"]), "--team")).toBe("T1");
    expect(errorOf(() => parseCommand("setup hooks", ["--team", "T1"])).suggestions).toEqual([
      "`setup hooks` takes no flags (--help always allowed)",
    ]);
  });
});

describe("parseFields", () => {
  const valid = ["is_member", "topic", "purpose"];
  it("returns the requested names", () => {
    expect(parseFields("channels", "topic, purpose", valid)).toEqual(["topic", "purpose"]);
    expect(parseFields("channels", undefined, valid)).toEqual([]);
  });
  it("refuses an unknown name and lists the valid ones", () => {
    const err = errorOf(() => parseFields("channels", "topic,unread", valid));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("unknown --fields name for `channels`: unread");
    expect(err.suggestions).toEqual(["valid --fields for `channels`: is_member, topic, purpose"]);
  });
});

describe("isLongFlag", () => {
  it("is `--` then a letter", () => {
    expect(isLongFlag("--preview")).toBe(true);
    expect(isLongFlag("---")).toBe(false);
    expect(isLongFlag("- item")).toBe(false);
    expect(isLongFlag("-v")).toBe(false);
    expect(isLongFlag("--")).toBe(false);
  });
});
