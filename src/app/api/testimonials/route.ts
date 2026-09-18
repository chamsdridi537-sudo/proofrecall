import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { collectTags, MAX_BATCH_ITEMS, parseBatch } from "@/lib/parse-batch";
import type { ImportError, LibraryResponse, TestimonialRow } from "@/lib/types";

/**
 * GET  /api/testimonials          — the caller's library, newest first
 * POST /api/testimonials          — paste-a-batch import
 *
 * Reads go through the same `search_testimonials` function with an empty query
 * (its "recent" tier), so a row always carries its aggregated tags and the
 * dashboard only has to understand one response shape.
 *
 * Everything here is RLS-bound: the client is built from the caller's own
 * session cookies, so a query can only ever touch that user's rows. There is no
 * service-role key anywhere in the app.
 */
export const dynamic = "force-dynamic";

const MAX_TAGS_PER_ITEM = 12;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tag = (searchParams.get("tag") ?? "").trim() || null;
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const body: LibraryResponse = { results: [], error: "unauthenticated" };
    return NextResponse.json(body, { status: 401 });
  }

  const { data, error } = await supabase.rpc("search_testimonials", {
    query: null,
    tag_name: tag,
    result_limit: limit,
  });

  if (error) {
    const body: LibraryResponse = { results: [], error: error.message };
    return NextResponse.json(body, { status: 500 });
  }

  const body: LibraryResponse = { results: (data ?? []) as TestimonialRow[] };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const body: ImportError = {
      imported: 0,
      skipped: [],
      truncated: false,
      message: "Sign in first.",
    };
    return NextResponse.json(body, { status: 401 });
  }

  let raw = "";
  try {
    const payload = (await request.json()) as { raw?: unknown };
    raw = typeof payload?.raw === "string" ? payload.raw : "";
  } catch {
    const body: ImportError = {
      imported: 0,
      skipped: [],
      truncated: false,
      message: "Send JSON like { \"raw\": \"…\" }.",
    };
    return NextResponse.json(body, { status: 400 });
  }

  const parsed = parseBatch(raw);

  if (parsed.items.length === 0) {
    const body: ImportError = {
      imported: 0,
      skipped: parsed.skipped,
      truncated: false,
      message: "Nothing usable to import — each line needs a quote.",
    };
    return NextResponse.json(body, { status: 422 });
  }

  // 1. Testimonials first: the quote is the thing we search, so it cannot fail
  //    silently. `.select()` gives the new ids back, and RLS guarantees they are
  //    ours.
  const { data: inserted, error: insertError } = await supabase
    .from("testimonials")
    .insert(
      parsed.items.map((item) => ({
        quote: item.quote,
        author: item.author,
        author_role: item.author_role,
        author_company: item.author_company,
        source: item.source,
      })),
    )
    .select("id, quote");

  if (insertError) {
    const body: ImportError = {
      imported: 0,
      skipped: parsed.skipped,
      truncated: parsed.truncated,
      message: insertError.message,
    };
    return NextResponse.json(body, { status: 500 });
  }

  const newRows = (inserted ?? []) as Pick<TestimonialRow, "id" | "quote">[];

  // 2. Tags: upsert per user, then re-read to learn the ids. `ignoreDuplicates`
  //    means ON CONFLICT DO NOTHING, which needs no UPDATE policy — owners may
  //    add tags, never rewrite them.
  const tagNames = collectTags(parsed.items)
    .filter((name) => name.length > 0)
    .slice(0, MAX_TAGS_PER_ITEM * parsed.items.length);

  const tagIdsByName = new Map<string, string>();

  if (tagNames.length > 0) {
    const { error: tagError } = await supabase
      .from("tags")
      .upsert(tagNames.map((name) => ({ name })), {
        onConflict: "user_id,name",
        ignoreDuplicates: true,
      });

    if (tagError) {
      const body: ImportError = {
        imported: newRows.length,
        skipped: parsed.skipped,
        truncated: parsed.truncated,
        message: `Imported, but tags failed: ${tagError.message}`,
      };
      return NextResponse.json(body, { status: 201 });
    }

    type TagRow = { id: string; name: string };
    const { data: tags } = await supabase
      .from("tags")
      .select("id, name")
      .in("name", tagNames);

    for (const row of (tags ?? []) as TagRow[]) {
      tagIdsByName.set(row.name, row.id);
    }
  }

  // 3. Link them. Quotes are not unique, so each returned row is matched to its
  //    parsed item by consuming candidates one at a time.
  const candidates = new Map<string, string[]>();
  for (const row of newRows) {
    const bucket = candidates.get(row.quote) ?? [];
    bucket.push(row.id);
    candidates.set(row.quote, bucket);
  }

  const links: { testimonial_id: string; tag_id: string }[] = [];
  for (const item of parsed.items) {
    const id = candidates.get(item.quote)?.shift();
    if (!id) continue;
    for (const tag of item.tags) {
      const tagId = tagIdsByName.get(tag);
      if (tagId) links.push({ testimonial_id: id, tag_id: tagId });
    }
  }

  if (links.length > 0) {
    const { error: linkError } = await supabase
      .from("testimonial_tags")
      .insert(links);

    if (linkError) {
      const body: ImportError = {
        imported: newRows.length,
        skipped: parsed.skipped,
        truncated: parsed.truncated,
        message: `Imported, but tagging failed: ${linkError.message}`,
      };
      return NextResponse.json(body, { status: 201 });
    }
  }

  const body: ImportError = {
    imported: newRows.length,
    skipped: parsed.skipped,
    truncated: parsed.truncated || parsed.items.length > MAX_BATCH_ITEMS,
  };
  return NextResponse.json(body, { status: 201 });
}
