import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Library from "@/components/library";
import type { TestimonialRow } from "@/lib/types";

/**
 * Day 3: the retrieval surface. Day 4: the first page of the library.
 *
 * This stays a Server Component that verifies the session itself, so a
 * misconfigured proxy can never leak the dashboard. It reads the profile row
 * and the first page of the browse view here — the rest of the searching is
 * still done by the client against /api/search and /api/testimonials, which are
 * RLS-bound too.
 *
 * Why the first page is fetched server-side: an empty library must look empty
 * in the HTML that first paints, otherwise a new visitor stares at a spinner and
 * never learns that the search box is the point of the product. A failed query
 * passes `null` so the client falls back to fetching on mount — a slow server
 * round trip can degrade the page, never break it.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS in action: this query can only ever return the caller's own row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .single();

  const { data: library } = await supabase.rpc("search_testimonials", {
    query: null,
    tag_name: null,
    result_limit: 50,
  });

  const initialRows: TestimonialRow[] | null = Array.isArray(library)
    ? (library as TestimonialRow[])
    : null;

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-12">
      <div className="flex w-full max-w-3xl items-center justify-between gap-4">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          {profile?.full_name ? `${profile.full_name} · ` : ""}
          {user.email}
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Sign out
          </button>
        </form>
      </div>

      <div className="mt-6 flex w-full justify-center">
        <Library initialRows={initialRows} />
      </div>
    </main>
  );
}
