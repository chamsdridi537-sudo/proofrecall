import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Defense in depth: the proxy already blocks anonymous users, but this
  // page verifies the session itself so a misconfigured proxy can never
  // leak the dashboard.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS in action: this query can only ever return the caller's own row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, created_at")
    .single();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          Protected area
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {profile?.full_name ? `Welcome, ${profile.full_name}` : "Dashboard"}
        </h1>

        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Signed in as</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">User ID</dt>
            <dd className="font-mono text-xs break-all">{user.id}</dd>
          </div>
          {profile?.created_at && (
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Member since</dt>
              <dd className="font-medium">
                {new Date(profile.created_at).toLocaleDateString()}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Your testimonial library, tagging, and 5-second search land here on
          Day 3.
        </p>

        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="w-full rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
