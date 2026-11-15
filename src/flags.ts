/**
 * The one strict flag parser every command goes through, and the table of what each command declares.
 * Nothing is silently dropped: an undeclared flag, a value flag without its value and an extra
 * positional all fail before any Slack call. See specs/behaviors/errors.md → Declared flags.
 *
 * Shaped like the house parser (nexudus-axi `src/flags.ts`), with one deliberate difference: this tool
 * takes free text as positionals, so only `--<letter>` starts a flag. `- item`, `---`, `-word` and `-5`
 * are text.
 */
import { AxiError } from "axi-sdk-js";

export interface FlagSpec {
  /** Flags that take a value, e.g. `--limit 10`. */
  value?: string[];
  /** Standalone switches, e.g. `--full`. */
  boolean?: string[];
  /** Repeatable value flags; every occurrence is kept, in order. */
  multi?: string[];
  /** Flags this command refuses on purpose, mapped to a targeted hint shown in place of the list. */
  deprecated?: Record<string, string>;
  /** How many positional arguments the command takes: a count, or `"many"`. Defaults to 0. */
  positionals?: number | "many";
  /**
   * The positionals are free text (a message body, a search query), so any dash-led argument that
   * isn't a long flag is text. Without it a short flag (`-x`) is refused: there are no short flags.
   */
  text?: boolean;
  /** `false` for a command that never resolves a workspace, so `--team` is refused there too. */
  team?: false;
  /** Usage line shown when the positionals are wrong. */
  usage?: string;
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
  /** Values collected from `multi` flags, per flag, in the order given. */
  multi: Record<string, string[]>;
  /** Every `multi` occurrence across flags, in the order given. */
  ordered: Array<{ name: string; value: string }>;
}

/** The workspace selector, valid on every command that acts on a workspace. */
const TEAM_FLAG = "--team";

/** Whether an argument is shaped like a long flag (`--` then a letter) — `-x`, `---`, `- item` are not. */
export function isLongFlag(arg: string): boolean {
  return /^--[A-Za-z]/.test(arg);
}

/** A short flag (`-x`, `-abc`): refused on commands whose positionals aren't free text. */
function isShortFlag(arg: string): boolean {
  return /^-[A-Za-z]/.test(arg);
}

/** The flags a command declares, sorted, without the always-allowed ones. */
export function declaredFlags(spec: FlagSpec): string[] {
  return [...(spec.value ?? []), ...(spec.boolean ?? []), ...(spec.multi ?? [])].sort();
}

/** The parenthetical naming what is valid everywhere, true of the command printing it. */
function alwaysAllowed(spec: FlagSpec): string {
  return spec.team === false ? "(--help always allowed)" : "(--help and --team always allowed)";
}

/** Parse argv for one command against its declaration, rejecting anything not declared. */
export function parseFlags(command: string, argv: string[], spec: FlagSpec): Parsed {
  const valueFlags = new Set(spec.value ?? []);
  if (spec.team !== false) valueFlags.add(TEAM_FLAG);
  const boolFlags = new Set(spec.boolean ?? []);
  const multiFlags = new Set(spec.multi ?? []);
  const deprecated = spec.deprecated ?? {};
  const known = declaredFlags(spec);

  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const multi: Record<string, string[]> = {};
  const ordered: Array<{ name: string; value: string }> = [];

  // The single place a flag is rejected, so the wording can't drift between commands.
  const unknown = (typed: string, name: string): never => {
    const hint = deprecated[name];
    throw new AxiError(`unknown flag ${typed} for \`${command}\``, "UNKNOWN_FLAG", [
      hint ??
        (known.length > 0
          ? `valid flags for \`${command}\`: ${known.join(", ")} ${alwaysAllowed(spec)}`
          : `\`${command}\` takes no flags ${alwaysAllowed(spec)}`),
    ]);
  };

  const valueOf = (name: string, inline: string | undefined, i: number): string => {
    if (inline !== undefined) return inline;
    const next = argv[i + 1];
    // A following long flag is never taken as the value: `--reply --preview` must not eat `--preview`.
    if (next === undefined || isLongFlag(next)) {
      throw new AxiError(`${name} needs a value`, "USAGE", [`Pass it as \`${name} <value>\``]);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!isLongFlag(arg)) {
      if (!spec.text && isShortFlag(arg)) unknown(arg, arg);
      positional.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    if (name === "--help") {
      flags["--help"] = true;
      continue;
    }

    // Refused flags are checked first and parse bare, so the hint fires even without a value.
    if (name in deprecated) unknown(name, name);

    if (boolFlags.has(name)) {
      if (inline !== undefined) {
        throw new AxiError(`${name} is a switch and takes no value`, "USAGE", [
          `Pass \`${name}\` on its own`,
        ]);
      }
      flags[name] = true;
      continue;
    }

    if (valueFlags.has(name)) {
      if (flags[name] !== undefined) {
        throw new AxiError(`${name} was given more than once`, "USAGE", [
          `Pass \`${name} <value>\` once`,
        ]);
      }
      flags[name] = valueOf(name, inline, i);
      if (inline === undefined) i++;
      continue;
    }

    if (multiFlags.has(name)) {
      const value = valueOf(name, inline, i);
      if (inline === undefined) i++;
      (multi[name] ??= []).push(value);
      ordered.push({ name, value });
      continue;
    }

    unknown(name, name);
  }

  const max = spec.positionals ?? 0;
  if (max !== "many" && positional.length > max && flags["--help"] === undefined) {
    const extra = positional.slice(max);
    throw new AxiError(
      `unexpected argument${extra.length > 1 ? "s" : ""} for \`${command}\`: ${extra.join(" ")}`,
      "USAGE",
      [
        `\`${command}\` takes ${max === 0 ? "no positional arguments" : `${max} positional argument${max > 1 ? "s" : ""}`}${
          spec.usage ? `; usage: ${spec.usage}` : ""
        }`,
      ],
    );
  }

  return { positional, flags, multi, ordered };
}

/** Parse argv against a command's entry in `FLAG_SPECS`. */
export function parseCommand(command: CommandName, argv: string[]): Parsed {
  return parseFlags(command, argv, FLAG_SPECS[command]);
}

/** A `USAGE` error carrying the command's declared usage line. */
export function usageError(command: CommandName, hints: string[] = []): AxiError {
  return new AxiError(
    `usage: ${FLAG_SPECS[command].usage ?? `slack-axi ${command}`}`,
    "USAGE",
    hints,
  );
}

/** A value flag's value, if it was given. */
export function str(parsed: Parsed, name: string): string | undefined {
  const raw = parsed.flags[name];
  return typeof raw === "string" ? raw : undefined;
}

/** Whether a switch was given. */
export function bool(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] !== undefined;
}

/** Every value given for a `multi` flag (empty when absent). */
export function multiStr(parsed: Parsed, name: string): string[] {
  return parsed.multi[name] ?? [];
}

/**
 * Validate a comma-separated `--fields` value against the names a command offers. An unknown name is an
 * error: ignoring it would hand back a table missing a column the agent asked for.
 */
export function parseFields(command: string, value: string | undefined, valid: string[]): string[] {
  if (value === undefined) return [];
  const names = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = names.filter((n) => !valid.includes(n));
  if (bad.length > 0) {
    throw new AxiError(
      `unknown --fields name${bad.length > 1 ? "s" : ""} for \`${command}\`: ${bad.join(", ")}`,
      "VALIDATION_ERROR",
      [`valid --fields for \`${command}\`: ${valid.join(", ")}`],
    );
  }
  return names;
}

// ---------------------------------------------------------------------------- declarations
// One entry per command or subcommand. Keeping them in one table is what makes rejection consistent,
// and lets a test walk every command. `--help` and (unless `team: false`) `--team` are never listed.

const NO_ATTACHMENTS = (command: string): Record<string, string> => {
  const hint = `\`${command}\` cannot add or change attachments: Slack cannot change a message's files. Delete and re-post with \`slack-axi draft <channel> "<text>" --file <path>\``;
  return { "--file": hint, "--snippet": hint };
};

export const FLAG_SPECS = {
  "auth setup": {
    value: ["--name", "--confirm-step"],
    boolean: ["--show-manifest", "--reset"],
    usage:
      "slack-axi auth setup [--name <name>] [--confirm-step app_created] [--show-manifest] [--reset]",
  },
  "auth login": {
    value: ["--token"],
    boolean: ["--token-stdin"],
    usage: "slack-axi auth login [--token-stdin | --token <xoxp-...>] [--team <id>]",
  },
  "auth workspaces": { team: false, usage: "slack-axi auth workspaces" },
  "auth use": { positionals: 1, usage: "slack-axi auth use <team>" },
  "auth mode": { positionals: 1, usage: "slack-axi auth mode [human|bot|auto] [--team <id>]" },
  "auth revoke": { positionals: 1, usage: "slack-axi auth revoke <team>" },
  doctor: { usage: "slack-axi doctor [--team <id>]" },
  channels: {
    value: ["--type", "--match", "--limit", "--fields"],
    boolean: ["--all"],
    usage: "slack-axi channels [flags]",
  },
  dms: { value: ["--limit"], usage: "slack-axi dms [--limit <n>]" },
  members: {
    value: ["--limit"],
    positionals: 1,
    usage: "slack-axi members <channel> [--limit <n>]",
  },
  audience: {
    value: ["--max-members"],
    boolean: ["--members"],
    positionals: 1,
    usage: "slack-axi audience <channel> [--members] [--max-members <n>] [--team <id>]",
  },
  user: { positionals: "many", usage: "slack-axi user <id|@handle> [more...]" },
  "cache refresh": { usage: "slack-axi cache refresh [--team <id>]" },
  read: {
    value: ["--since", "--from", "--to", "--tz", "--limit", "--threads"],
    boolean: ["--exclude-bots", "--cite", "--full"],
    positionals: 1,
    usage: "slack-axi read <channel> [flags]",
  },
  thread: {
    boolean: ["--full"],
    positionals: 2,
    usage: "slack-axi thread <channel> <ts> [--full]",
  },
  cite: { positionals: "many", usage: "slack-axi cite <channel> <ts> [<ts> ...]" },
  search: {
    value: [
      "--in",
      "--from",
      "--with",
      "--to",
      "--after",
      "--before",
      "--on",
      "--during",
      "--type",
      "--limit",
    ],
    multi: ["--has", "--is"],
    boolean: ["--files", "--cite", "--full"],
    positionals: "many",
    text: true,
    usage: 'slack-axi search ["<query>"] [flags]',
  },
  catchup: {
    value: [
      "--since",
      "--from",
      "--to",
      "--tz",
      "--every",
      "--type",
      "--match",
      "--in",
      "--limit-per",
      "--max-channels",
    ],
    boolean: ["--exclude-bots", "--cite", "--full"],
    usage: "slack-axi catchup [flags]",
  },
  react: { positionals: 3, usage: "slack-axi react <channel> <ts> <:emoji:>" },
  reactions: { positionals: 2, usage: "slack-axi reactions <channel> <ts>" },
  download: {
    value: ["--out"],
    positionals: "many",
    usage: "slack-axi download <file-id...> [--out <dir>]",
  },
  file: { boolean: ["--full"], positionals: "many", usage: "slack-axi file <file-id...> [--full]" },
  draft: {
    value: ["--reply"],
    multi: ["--file", "--snippet"],
    boolean: ["--raw", "--preview", "--no-unfurl"],
    positionals: "many",
    text: true,
    usage:
      'slack-axi draft <channel> ["<markdown>"] [--reply <ts>] [--file <path>]… [--snippet <path>]… [--raw] [--preview] [--no-unfurl]',
  },
  "draft send": { positionals: 1, team: false, usage: "slack-axi draft send <draft-id>" },
  "draft list": { boolean: ["--all"], team: false, usage: "slack-axi draft list [--all]" },
  "draft discard": { positionals: 1, team: false, usage: "slack-axi draft discard <draft-id>" },
  edit: {
    boolean: ["--raw", "--preview", "--no-unfurl"],
    deprecated: NO_ATTACHMENTS("edit"),
    positionals: "many",
    text: true,
    usage: 'slack-axi edit <channel> <ts> "<new text>"  |  edit <sent-draft-id> "<new text>"',
  },
  delete: {
    deprecated: NO_ATTACHMENTS("delete"),
    positionals: 2,
    usage: "slack-axi delete <channel> <ts>  |  delete <sent-draft-id>",
  },
  "setup hooks": { team: false, usage: "slack-axi setup hooks" },
} satisfies Record<string, FlagSpec>;

export type CommandName = keyof typeof FLAG_SPECS;
