export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight">
          Log in to ProofRecall
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Authentication (Supabase magic link + OAuth) is wired on Day 2. This
          is a placeholder.
        </p>
        <button
          type="button"
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-full bg-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
        >
          Coming on Day 2
        </button>
        <a
          href="/"
          className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Back home
        </a>
      </div>
    </main>
  );
}
