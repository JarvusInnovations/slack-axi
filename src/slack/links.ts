/**
 * Link-unfurl attachments. When a shared URL unfurls, Slack adds an `attachments[]` entry on the
 * message carrying the canonical link plus a title; it rides on the history/replies payload already
 * fetched, so surfacing it costs no call and no scope. See specs/behaviors/links.md.
 */

/** A link carried by a message's unfurl attachment — the URL is always whole. */
export interface LinkMeta {
  url: string;
  title?: string;
  service?: string;
}

/**
 * Normalize one raw Slack attachment into a link, or `undefined` when it carries no URL (a message
 * share, a plain-text legacy attachment, an image-only unfurl). The canonical URL is `title_link`,
 * else `from_url`, else `original_url`.
 */
export function toLinkMeta(raw: Record<string, unknown>): LinkMeta | undefined {
  const url = [raw.title_link, raw.from_url, raw.original_url].find(
    (v): v is string => typeof v === "string" && /^https?:\/\//.test(v),
  );
  if (!url) return undefined;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined;
  const service =
    typeof raw.service_name === "string" && raw.service_name.trim()
      ? raw.service_name.trim()
      : undefined;
  return { url, ...(title ? { title } : {}), ...(service ? { service } : {}) };
}

/** Map a message's raw `attachments[]` to links, dropping URL-less entries and duplicate URLs. */
export function linksFromAttachments(attachments: unknown): LinkMeta[] {
  if (!Array.isArray(attachments)) return [];
  const seen = new Set<string>();
  const links: LinkMeta[] = [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const link = toLinkMeta(a as Record<string, unknown>);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }
  return links;
}

/**
 * Inline summary for a `read`/`thread` row: `Q3 budget <https://docs.google.com/…>; Repo <https://…>`,
 * `; `-joined in payload order. A title-less link is the bare URL. Empty input → `""`. Pure.
 */
export function summarizeLinks(links: LinkMeta[]): string {
  return links.map((l) => (l.title ? `${l.title} <${l.url}>` : l.url)).join("; ");
}
