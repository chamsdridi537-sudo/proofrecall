import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * RLS verification endpoint (Day 2 deliverable #7).
 *
 * It selects ALL rows from `profiles` using the caller's own session.
 * With RLS correctly enforced:
 *   - signed in  → exactly 1 row: the caller's own profile
 *   - anonymous  → 0 rows
 *
 * Safe by design: RLS means this endpoint can never reveal anyone
 * else's data, no matter who calls it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("email");

  return NextResponse.json({
    viewer: user?.email ?? null,
    authenticated: Boolean(user),
    rows_visible: profiles?.length ?? 0,
    emails_visible_to_this_caller: profiles?.map((p) => p.email) ?? [],
    query_error: error?.message ?? null,
    note: "RLS is working if rows_visible is 1 when signed in and 0 when anonymous.",
  });
}
