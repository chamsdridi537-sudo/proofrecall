export default function DashboardPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          Protected area
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Your testimonial library, tagging, and 5-second search land here.
          Route protection (Supabase Auth + RLS) is added on Day 2.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Go to login
        </a>
      </div>
    </main>
  );
}
