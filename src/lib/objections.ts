/**
 * The six things a prospect actually says, and the one word that retrieves the
 * quote which answers them.
 *
 * Why a single word per chip, and not the sentence on the label: the full-text
 * tier runs `plainto_tsquery('english', query)` (see
 * `supabase/migrations/0002_testimonials.sql`), which ANDs every lexeme. A chip
 * labelled "It's too expensive" that searched for that phrase would have to find
 * a testimonial containing *it*, *too* and *expensive* — which is to say it would
 * return nothing, every time. So the label speaks the way the prospect speaks and
 * the query speaks the way the testimonial was written.
 *
 * Each `query` below is therefore a stem that appears in the body of a real
 * quote, not a tag name: `search_text` is built from the quote only, so a tag
 * called #roi would not be matched by `roi` unless a customer also wrote the
 * word. `scripts/qa/day5.mjs` asserts that all six return at least one row
 * against the seeded demo library, which is what keeps this list honest when the
 * fixtures move.
 *
 * Multi-term chips ("expensive OR pricing OR cost") are one small function
 * change away — `websearch_to_tsquery` keeps single-word behaviour identical and
 * adds OR and quoted phrases. Deliberately not done here: it is a production
 * migration, and the tier it touches is the one the whole product rests on.
 */

export type Objection = {
  /** The prospect's words, shown on the chip. */
  said: string;
  /** The term we search for — one stem, present in the quote's own text. */
  query: string;
};

export const OBJECTIONS: Objection[] = [
  { said: "It's too expensive", query: "pricing" },
  { said: "What's the payback, honestly?", query: "roi" },
  { said: "Rollouts always slip here", query: "onboarding" },
  { said: "We're mid-contract with someone else", query: "migration" },
  { said: "Security will never approve it", query: "security" },
  { said: "Nobody on our team will use it", query: "activation" },
];
