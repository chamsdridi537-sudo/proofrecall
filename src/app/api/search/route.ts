import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MatchKind, SearchResponse, TestimonialRow } from "@/lib/types";

/**
 * GET /api/search?q=pricing&tag=roi&limit=25
 *
 * Retrieval is the product, so it lives in one SQL function
 * (`search_testimonials`) that we call over RPC. The function is SECURITY
 * INVOKER, so RLS narrows every tier to the signed-in user's rows — this
 * handler never has to remember to add a `user_id` filter.
 *
 * Tiers: full text (tsvector + ts_rank) first; if that finds nothing, trigram
 * word-similarity so "prcing" still returns the pricing quote; with no query at
 * all, newest first.
 */
export const dynamic = "force-dynamic";

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const tag = (searchParams.get("tag") ?? "").trim() || null;
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "25", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, MIN_LIMIT), MAX_LIMIT)
    : 25;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const body: SearchResponse = {
      results: [],
      query: q,
      tag,
      match_kind: null,
      ms: 0,
      error: "unauthenticated",
    };
    return NextResponse.json(body, { status: 401 });
  }

  const startedAt = Date.now();
  const { data, error } = await supabase.rpc("search_testimonials", {
    query: q || null,
    tag_name: tag,
    result_limit: limit,
  });
  const ms = Date.now() - startedAt;

  if (error) {
    const body: SearchResponse = {
      results: [],
      query: q,
      tag,
      match_kind: null,
      ms,
      error: error.message,
    };
    return NextResponse.json(body, { status: 500 });
  }

  const rows = (data ?? []) as TestimonialRow[];
  // The function commits to one tier per call, so the first row reports it.
  const matchKind: MatchKind | null = rows[0]?.match_kind ?? null;

  const body: SearchResponse = {
    results: rows,
    query: q,
    tag,
    match_kind: matchKind,
    ms,
  };
  return NextResponse.json(body);
}
