/**
 * The six things a prospect actually says, and the search that answers them.
 *
 * Each `query` is two words joined with `or`, and that shape is the whole point:
 * the tier-1 full-text function parses the query with `websearch_to_tsquery`
 * (see `supabase/migrations/0004_websearch_tsquery.sql`), which reads `or` as a
 * union. So "Security will never approve it" can ask for a testimonial that
 * mentions `security` *or* one that mentions `procurement` — which is how a
 * single objection reaches two different customers' quotes, phrased two
 * different ways, instead of betting the answer on one word being present.
 *
 * Before that migration this list could only hold one word per chip.
 * `plainto_tsquery` ANDs every lexeme, so a chip searching "security or
 * procurement" meant "find a quote containing both", and the measured result on
 * this library was one row, arriving by trigram fallback — the union silently
 * collapsed to whichever word happened to be nearer the typo-tolerance
 * threshold. `scripts/qa/day6.mjs` pins the union law today so a future change
 * to the search function cannot quietly break it again.
 *
 * Both words in every pair below are words a *customer wrote in the body of a
 * quote*, not a tag name: `search_text` is built from the quote only, so a tag
 * called #roi would not be matched by `roi` unless someone also wrote the word.
 * `scripts/qa/fixtures.mjs` mirrors this list for the QA scripts (which run on
 * plain node and cannot import a `.ts` file), and day6.mjs fails if the two ever
 * drift apart.
 */

export type Objection = {
  /** The prospect's words, shown on the chip. */
  said: string;
  /** The query we run — two stems, unioned by `or`. */
  query: string;
};

export const OBJECTIONS: Objection[] = [
  { said: "It's too expensive", query: "pricing or expensive" },
  { said: "What's the payback, honestly?", query: "roi or paid" },
  { said: "Rollouts always slip here", query: "onboarding or migration" },
  { said: "We're mid-contract with someone else", query: "contract or vendor" },
  { said: "Security will never approve it", query: "security or procurement" },
  { said: "Nobody on our team will use it", query: "activation or team" },
];

/**
 * The query in human form: `pricing or expensive` becomes `pricing OR expensive`.
 *
 * A chip shows the prospect's words and searches the union, so the two are never
 * the same string once `or` exists. That is worth surfacing rather than hiding:
 * a seller who sees `pricing OR expensive` learns the operator works in their
 * search box too, instead of finding a mystery query there the first time they
 * look. `src/components/library.tsx` puts this in each chip's tooltip.
 */
export function searchedPhrase(query: string): string {
  return query
    .split(/\s+or\s+/i)
    .map((term) => term.trim())
    .filter(Boolean)
    .join(" OR ");
}
