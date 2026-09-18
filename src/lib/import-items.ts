/**
 * The one place that writes a testimonial batch to Postgres (Day 4).
 *
 * Both importers — paste-a-batch and CSV upload — end up here, so there is a
 * single implementation of the three-step dance:
 *
 *   1. insert the quotes, skipping duplicates instead of failing the batch
 *   2. upsert this user's tags, then read their ids back
 *   3. link quotes to tags
 *
 * The duplicate rule is enforced by `testimonials_user_quote_hash_key`
 * (migration 0003), which is why this uses an upsert with
 * `ignoreDuplicates: true`: `ON CONFLICT DO NOTHING` needs INSERT and SELECT
 * only, never UPDATE — `tags` deliberately has no UPDATE policy, and owners
 * should not be able to rewrite a quote that was already captured.
 *
 * Everything runs through the caller's own session, so RLS applies to all three
 * steps; a duplicate quote owned by another customer is invisible here, which
 * is exactly the property a cross-tenant SaaS needs.
 */

import { collectTags, type ParsedTestimonial } from "@/lib/parse-batch";
import { normaliseQuote } from "@/lib/csv-import";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const MAX_TAGS = 12 * 50;

export type InsertOutcome = {
  /** Rows that were actually written (duplicates excluded). */
  inserted: ParsedTestimonial[];
  /** Items skipped because this owner already has that quote. */
  duplicates: ParsedTestimonial[];
  /** Set when the rows landed but a later step failed. */
  warning?: string;
  /** Set when nothing could be written. */
  error?: string;
};

export async function insertTestimonialBatch(
  supabase: ServerClient,
  items: ParsedTestimonial[],
): Promise<InsertOutcome> {
  if (items.length === 0) {
    return { inserted: [], duplicates: [] };
  }

  const { data: written, error: insertError } = await supabase
    .from("testimonials")
    .upsert(
      items.map((item) => ({
        quote: item.quote,
        author: item.author,
        author_role: item.author_role,
        author_company: item.author_company,
        source: item.source,
      })),
      { onConflict: "user_id,quote_hash", ignoreDuplicates: true },
    )
    .select("id, quote");

  if (insertError) {
    return { inserted: [], duplicates: [], error: insertError.message };
  }

  // The response only carries rows that were really inserted, so the ones that
  // are missing are this owner's existing quotes. Quotes are matched back by
  // their normalised text, consuming candidates one at a time so two identical
  // rows in one batch behave like one insert plus one duplicate.
  const buckets = new Map<string, string[]>();
  for (const row of (written ?? []) as { id: string; quote: string }[]) {
    const key = normaliseQuote(row.quote);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row.id);
    buckets.set(key, bucket);
  }

  const inserted: ParsedTestimonial[] = [];
  const duplicates: ParsedTestimonial[] = [];
  const writtenRows: { id: string; item: ParsedTestimonial }[] = [];

  for (const item of items) {
    const id = buckets.get(normaliseQuote(item.quote))?.shift();
    if (!id) {
      duplicates.push(item);
      continue;
    }
    inserted.push(item);
    writtenRows.push({ id, item });
  }

  if (inserted.length === 0) {
    return { inserted: [], duplicates };
  }

  const tagNames = collectTags(inserted)
    .filter((name) => name.length > 0)
    .slice(0, MAX_TAGS);

  const tagIdsByName = new Map<string, string>();

  if (tagNames.length > 0) {
    const { error: tagError } = await supabase
      .from("tags")
      .upsert(tagNames.map((name) => ({ name })), {
        onConflict: "user_id,name",
        ignoreDuplicates: true,
      });

    if (tagError) {
      return {
        inserted,
        duplicates,
        warning: `Imported, but tags failed: ${tagError.message}`,
      };
    }

    const { data: tags } = await supabase
      .from("tags")
      .select("id, name")
      .in("name", tagNames);

    for (const row of (tags ?? []) as { id: string; name: string }[]) {
      tagIdsByName.set(row.name, row.id);
    }
  }

  const links: { testimonial_id: string; tag_id: string }[] = [];
  for (const { id, item } of writtenRows) {
    for (const tag of item.tags) {
      const tagId = tagIdsByName.get(tag);
      if (tagId) links.push({ testimonial_id: id, tag_id: tagId });
    }
  }

  if (links.length > 0) {
    const { error: linkError } = await supabase
      .from("testimonial_tags")
      .upsert(links, { onConflict: "testimonial_id,tag_id", ignoreDuplicates: true });

    if (linkError) {
      return {
        inserted,
        duplicates,
        warning: `Imported, but tagging failed: ${linkError.message}`,
      };
    }
  }

  return { inserted, duplicates };
}
