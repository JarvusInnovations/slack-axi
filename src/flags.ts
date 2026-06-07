/** Minimal, lenient flag parsing shared by commands. Unknown flags are left in `rest`. */

/** Extract a single string-valued flag (e.g. `--team T1`), returning the value and remaining args. */
export function takeFlag(args: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) {
      value = args[i + 1];
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
