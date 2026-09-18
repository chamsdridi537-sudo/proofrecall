import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseBatch } from "@/lib/parse-batch";
import { excerpt } from "@/lib/csv-import";
import { insertTestimonialBatch } from "@/lib/import-items";
import type { ImportError, LibraryResponse, TestimonialRow } from "@/lib/types";

/**
 * GET  /api/testimonials          — the caller's library, newest first
 * POST /api/testimonials          — paste-a-batch import
 *
 * Reads go through the same `search_testimonials` function with an empty query
 * (its "recent" tier), so a row always carries its aggregated tags and the
 * dashboard only has to understand one response shape.
 *
 * Writes go through `insertTestimonialBatch`, the single importer shared with
 * the CSV upload, so the two paths cannot drift apart.
 *
 * Everything here is RLS-bound: the client is built from the caller's own
 * session cookies, so a query can only ever touch that user's rows. There is no
 * service-role key anywhere in the app.
 */
export const dynamic = "force-dynamic";

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
      message: 'Send JSON like { "raw": "…" }.',
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

  // Quotes, tags and links are written by the shared helper, and a repeat of a
  // quote this owner already has is skipped instead of failing the whole batch.
  const outcome = await insertTestimonialBatch(supabase, parsed.items);

  if (outcome.error) {
    const body: ImportError = {
      imported: 0,
      skipped: parsed.skipped,
      truncated: parsed.truncated,
      message: outcome.error,
    };
    return NextResponse.json(body, { status: 500 });
  }

  const body: ImportError = {
    imported: outcome.inserted.length,
    skipped: parsed.skipped,
    truncated: parsed.truncated,
    duplicates: outcome.duplicates.map((item) => excerpt(item.quote)),
    ...(outcome.warning ? { message: outcome.warning } : {}),
  };
  return NextResponse.json(body, { status: 201 });
}
