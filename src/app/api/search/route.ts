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
 *
 * Why this route hedges (measured on Day 4, not theorised): across 21 warm
 * samples the same query for the same tenant took 122ms and 3382ms inside the
 * route, with the median at 151ms. That spread is connection and shared-compute
 * jitter on the free Postgres, not query cost — an eleven-row library cannot
 * take three seconds to scan. So if the first call has not answered inside
 * HEDGE_AFTER_MS we fire an identical one and take whichever returns first. The
 * function is read-only and stable, so a duplicate costs a second SELECT and
 * nothing else; a write path would never get this treatment.
 */
export const dynamic = "force-dynamic";

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

/** Roughly the point where a human starts wondering if the box worked. */
const HEDGE_AFTER_MS = 400;

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type RpcResult = { data: unknown[] | null; error: { message: string } | null };

function runSearch(
  supabase: ServerClient,
  args: { query: string | null; tag_name: string | null; result_limit: number },
): Promise<RpcResult> {
  return supabase
    .rpc("search_testimonials", args)
    .then((result) => ({
      data: (result.data ?? null) as unknown[] | null,
      error: result.error ? { message: result.error.message } : null,
    }))
    .catch((err: unknown) => ({
      data: null,
      error: { message: err instanceof Error ? err.message : "Search failed." },
    }));
}

/**
 * First answer within the budget wins; past the budget both are racing and the
 * `hedged` flag records that the slow path was real for this request.
 */
async function hedgedSearch(
  supabase: ServerClient,
  args: { query: string | null; tag_name: string | null; result_limit: number },
): Promise<{ result: RpcResult; ms: number; hedged: boolean }> {
  const startedAt = Date.now();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const outcome = new Promise<{ result: RpcResult; second: boolean }>((resolve) => {
    // Whoever answers first settles it; the other result is dropped, which is
    // safe because the query is a read-only SELECT.
    const take = (result: RpcResult, second: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ result, second });
    };

    void runSearch(supabase, args).then((result) => take(result, false));
    timer = setTimeout(() => {
      void runSearch(supabase, args).then((result) => take(result, true));
    }, HEDGE_AFTER_MS);
  });

  const { result, second } = await outcome;
  return { result, ms: Date.now() - startedAt, hedged: second };
}

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

  const { result, ms, hedged } = await hedgedSearch(supabase, {
    query: q || null,
    tag_name: tag,
    result_limit: limit,
  });

  if (result.error) {
    const body: SearchResponse = {
      results: [],
      query: q,
      tag,
      match_kind: null,
      ms,
      error: result.error.message,
    };
    return NextResponse.json(body, { status: 500 });
  }

  const rows = (result.data ?? []) as TestimonialRow[];
  // The function commits to one tier per call, so the first row reports it.
  const matchKind: MatchKind | null = rows[0]?.match_kind ?? null;

  const body: SearchResponse = {
    results: rows,
    query: q,
    tag,
    match_kind: matchKind,
    ms,
    hedged,
  };
  return NextResponse.json(body);
}
