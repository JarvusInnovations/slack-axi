/** Message-ts handle helpers. The dotless form is the compact display/citation handle. */

/** Dotless ts for display, e.g. `1717589640.123456` → `1717589640123456`. */
export function handle(ts: string): string {
  return ts.replace(".", "");
}

/** Accept a dotless or dotted ts; return the dotted form Slack APIs expect. */
export function dottedTs(ts: string): string {
  if (ts.includes(".")) return ts;
  if (ts.length <= 6) return ts;
  return `${ts.slice(0, ts.length - 6)}.${ts.slice(ts.length - 6)}`;
}
