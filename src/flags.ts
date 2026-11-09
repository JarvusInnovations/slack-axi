/**
 * Minimal, lenient flag parsing shared by commands. Unknown flags are left in `rest`. A value flag
 * given without its value is a USAGE error, never silently ignored. See specs/behaviors/errors.md.
 */
import { AxiError } from "axi-sdk-js";

/** Whether an argument is shaped like a long flag (`--` then a letter) — `-x`, `---`, `- item` are not. */
export function isLongFlag(arg: string): boolean {
  return /^--[A-Za-z]/.test(arg);
}

/** The value after a value flag at index `i`, or a USAGE error when it is missing or is another flag. */
function valueAt(args: string[], i: number, name: string): string {
  const value = args[i + 1];
  if (value === undefined || isLongFlag(value)) {
    throw new AxiError(`${name} needs a value`, "USAGE", [`Pass it as \`${name} <value>\``]);
  }
  return value;
}

/** Extract a single string-valued flag (e.g. `--team T1`), returning the value and remaining args. */
export function takeFlag(args: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      value = valueAt(args, i, name);
      i++;
      continue;
    }
    rest.push(args[i]);
  }
  return { value, rest };
}

/** Whether a boolean flag is present, returning the remaining args. */
export function takeBool(args: string[], name: string): { present: boolean; rest: string[] } {
  const rest = args.filter((a) => a !== name);
  return { present: rest.length !== args.length, rest };
}

/** Extract a repeatable string-valued flag (e.g. `--has link --has file`), collecting every value. */
export function takeFlags(args: string[], name: string): { values: string[]; rest: string[] } {
  const rest: string[] = [];
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      values.push(valueAt(args, i, name));
      i++;
      continue;
    }
    rest.push(args[i]);
  }
  return { values, rest };
}

/**
 * The free-text arguments left after every known flag was taken: anything not shaped like a long flag,
 * so dash-led text (`- item`, `---`, `-word`) survives. A leftover long flag is unknown → USAGE.
 */
export function textArgs(rest: string[]): string[] {
  const unknown = rest.find(isLongFlag);
  if (unknown) {
    throw new AxiError(`Unknown flag ${unknown}`, "USAGE", [
      "Run the command with `--help` to see its flags",
    ]);
  }
  return rest;
}
