/**
 * The line a seller pastes into a Slack thread, a deck, or a proposal — quote in
 * typographic quotes, then who said it, their role, and their company.
 *
 * This is the artifact the product is actually for: retrieval is only worth
 * paying for if the result can leave the tool in one click, carrying the credit
 * that makes it believable.
 *
 * Deliberately the same shape the paste importer writes
 * (`— Author, Role, Company` after the quote, see `src/lib/csv-import.ts`), so a
 * copied line can be pasted straight back into another account's library without
 * losing its attribution.
 *
 * Missing fields drop out instead of leaving dangling commas: a quote from an
 * email with no name still reads as a quote, not as a broken template.
 */

type Attributable = {
  quote: string;
  author: string | null;
  author_role: string | null;
  author_company: string | null;
};

function clean(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function attributedQuote(row: Attributable): string {
  const quote = clean(row.quote) ?? "";
  const who = [clean(row.author), clean(row.author_role), clean(row.author_company)]
    .filter((part): part is string => part !== null)
    .join(", ");

  if (!who) return `“${quote}”`;
  return `“${quote}” — ${who}`;
}
