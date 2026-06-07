import { homedir } from "node:os";
import { encode } from "@toon-format/toon";

/** Collapse the user's home directory prefix to `~` for display. */
export function collapseHome(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * Token-efficient TOON output helpers — the shared rendering boundary for every command.
 * See specs/behaviors/output-format.md. Internal logic stays on JSON; commands convert here.
 */

/** Encode a labeled value as a TOON block, e.g. `encodeBlock("workspace", {...})`. */
export function encodeBlock(label: string, value: unknown): string {
  return encode({ [label]: value });
}

/** Encode a flat key/value object as top-level TOON lines (no wrapping label). */
export function encodeObject(value: Record<string, unknown>): string {
  return encode(value);
}

/** Render a list of already-flat rows under a labeled TOON array with a count header. */
export function renderList(
  label: string,
  rows: Array<Record<string, unknown>>,
  options: { total?: number } = {},
): string {
  const total = options.total ?? rows.length;
  const header = total === rows.length ? `${label}[${rows.length}]` : `${label}[${rows.length} of ${total}]`;
  // Encode under a placeholder label, then swap in our count-annotated header.
  const encoded = encode({ [label]: rows });
  return encoded.replace(new RegExp(`^${label}\\[${rows.length}\\]`), header);
}

/**
 * Render help suggestions. encode() inlines primitive arrays, so we format manually to get the
 * multi-line `help[N]:` block the AXI standard uses.
 */
export function renderHelp(lines: string[]): string {
  const items = lines.filter((l) => l && l.length > 0);
  if (items.length === 0) return "";
  return `help[${items.length}]:\n${items.map((l) => `  ${l}`).join("\n")}`;
}

/** Render a structured error as TOON on stdout, with optional fixing suggestions. */
export function renderError(message: string, code: string, suggestions: string[] = []): string {
  return joinBlocks(encode({ error: message, code }), renderHelp(suggestions));
}

/** Join non-empty TOON blocks with single newlines. */
export function joinBlocks(...blocks: Array<string | undefined>): string {
  return blocks.filter((b): b is string => Boolean(b && b.length > 0)).join("\n");
}

/** Truncate free text to `max` chars, noting the original length. */
export function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}… (truncated, ${text.length} chars total)`;
}
