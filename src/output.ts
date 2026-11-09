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
  const header =
    total === rows.length ? `${label}[${rows.length}]` : `${label}[${rows.length} of ${total}]`;
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

/** The marker `truncate` appends; callers use `wasTruncated` to detect it on a rendered cell. */
export const TRUNCATION_MARK = "… (truncated, ";

const URL_RE = /https?:\/\/[^\s<>|)\]"']+/g;

/**
 * Truncate free text to ~`max` chars, noting the original length. A URL is atomic: if the cut would
 * land inside one, the preview extends to that URL's end — a URL prefix can't be followed and looks
 * like data, so it's worse than the whole URL. See specs/behaviors/output-format.md + links.md.
 */
export function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (start < cut && cut < end) {
      cut = end;
      break;
    }
  }
  if (cut >= text.length) return text;
  return `${text.slice(0, cut)}${TRUNCATION_MARK}${text.length} chars total)`;
}

/** Whether a rendered cell carries the truncation marker (i.e. `truncate` actually cut it). */
export function wasTruncated(rendered: unknown): boolean {
  return typeof rendered === "string" && rendered.includes(TRUNCATION_MARK);
}

/** Whether any row's `text` was truncated — drives the `--full` hint in `help[]`. */
export function anyTruncated(rows: Array<Record<string, unknown>>): boolean {
  return rows.some((r) => wasTruncated(r.text));
}

/** The `help[]` line that names the escape hatch, shown only when truncation actually occurred. */
export const FULL_HINT = "Some message text was truncated; re-run with `--full` for complete text";

/**
 * Make an inline column uniform (auto-when-present): if any row carries a non-empty string under
 * `key`, ensure every row has the key (empty string when it had none) so the TOON table stays compact;
 * otherwise drop the key entirely so the column vanishes. Returns whether the column was applied. Used
 * for the `reactions`, `files`, and `links` columns. See specs/behaviors/reactions.md + files.md + links.md.
 */
export function fillUniformColumn(rows: Array<Record<string, unknown>>, key: string): boolean {
  const any = rows.some((r) => typeof r[key] === "string" && (r[key] as string).length > 0);
  if (!any) {
    for (const r of rows) delete r[key];
    return false;
  }
  for (const r of rows) if (typeof r[key] !== "string") r[key] = "";
  return true;
}
