import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Library from "@/components/library";

/**
 * Day 3: the retrieval surface.
 *
 * This stays a Server Component that verifies the session itself, so a
 * misconfigured proxy can never leak the dashboard. It only reads the profile
 * row here — the testimonial library is fetched by the client from
 * /api/search and /api/testimonials, which are RLS-bound too.
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
        <Library />
      </div>
    </main>
  );
}
