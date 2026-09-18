/**
 * Paste-a-batch parser (Day 3).
 *
 * Deliberately forgiving: the point is to get testimonials out of email
 * threads and Slack and into the library in one action, not to make people
 * learn a format.
 *
 * A block is one testimonial. Blocks are separated by a blank line, or simply
 * written one per line. Inside a block:
 *
 *   "Switching paid for itself in a week." — Dana Whitfield, Head of Ops, Northwind via email #roi #pricing
 *
 *   - quotes around the text are optional and get trimmed
 *   - `—` (or ` - `) separates the quote from who said it
 *   - attribution parts are read as author, role, company (extra parts fold
 *     into company, so "Acme, Inc." survives)
 *   - `via something` anywhere in the attribution becomes the source
 *   - `#tag` tokens are collected, lowercased and removed from the prose
 */

export type ParsedTestimonial = {
  quote: string;
  author: string | null;
  author_role: string | null;
  author_company: string | null;
  source: string | null;
  tags: string[];
};

export const MAX_BATCH_ITEMS = 50;
export const MAX_QUOTE_LENGTH = 2000;

const TAG_PATTERN = /#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;

/** Tags are free text, normalised (not a fixed vocabulary). */
export function normaliseTag(rawToken: string): string {
  return rawToken.replace(/^#/, "").trim().toLowerCase();
}

function stripSurroundingQuotes(text: string): string {
  return text.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "");
}

/** Where the quote stops and the attribution starts. */
function findAttributionSplit(block: string): number {
  const emDash = block.lastIndexOf("—");
  if (emDash !== -1) return emDash;

  const enDash = block.lastIndexOf("–");
  if (enDash !== -1) return enDash;

  // Plain hyphen only counts when it is spaced out, so "5-year" stays in the quote.
  const spaced = block.lastIndexOf(" - ");
  return spaced === -1 ? block.length : spaced;
}

function parseAttribution(text: string): {
  author: string | null;
  author_role: string | null;
  author_company: string | null;
  source: string | null;
} {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let source: string | null = null;
  const kept: string[] = [];
  for (const part of parts) {
    const viaMatch = /^via\s+(.+)$/i.exec(part);
    if (viaMatch) {
      source = viaMatch[1].trim();
    } else {
      kept.push(part);
    }
  }

  const [author, second, ...rest] = kept;
  return {
    author: author ?? null,
    author_role: rest.length > 0 ? (second ?? null) : null,
    author_company:
      rest.length > 0 ? rest.join(", ") : (second ?? null),
    source,
  };
}

/** Split the paste into candidate blocks: blank lines first, then newlines. */
function toBlocks(raw: string): string[] {
  const byParagraph = raw
    .split(/\r?\n[ \t]*\r?\n/)
    .flatMap((chunk) => (chunk.trim() ? [chunk] : []));

  if (byParagraph.length > 1) {
    // Multi-line paragraphs stay together; a block is one testimonial.
    return byParagraph;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export type ParseResult = {
  items: ParsedTestimonial[];
  skipped: string[];
  truncated: boolean;
};

export function parseBatch(raw: string): ParseResult {
  const items: ParsedTestimonial[] = [];
  const skipped: string[] = [];
  let truncated = false;

  for (const block of toBlocks(raw)) {
    if (items.length >= MAX_BATCH_ITEMS) {
      truncated = true;
      break;
    }

    const tags: string[] = [];
    for (const token of block.match(TAG_PATTERN) ?? []) {
      const tag = normaliseTag(token);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }

    const cleaned = block.replace(TAG_PATTERN, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) {
      skipped.push(block.trim());
      continue;
    }

    const cut = findAttributionSplit(cleaned);
    const quote = stripSurroundingQuotes(cleaned.slice(0, cut));
    if (!quote) {
      skipped.push(block.trim());
      continue;
    }

    const attribution =
      cut === cleaned.length ? "" : cleaned.slice(cut + 1).replace(/^[\s—-]+/, "");
    const who = parseAttribution(attribution);

    items.push({
      quote: quote.slice(0, MAX_QUOTE_LENGTH),
      ...who,
      tags,
    });
  }

  return { items, skipped, truncated };
}

/** Every distinct tag across a batch, in first-seen order. */
export function collectTags(items: ParsedTestimonial[]): string[] {
  const seen: string[] = [];
  for (const item of items) {
    for (const tag of item.tags) {
      if (!seen.includes(tag)) seen.push(tag);
    }
  }
  return seen;
}
