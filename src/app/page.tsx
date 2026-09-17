const bullets = [
  {
    title: "Find the right quote in 5 seconds.",
    body: "Tag by use case, result, or objection — then search your wall and drop the perfect proof into any call, page, or pitch. The right words, right when it matters.",
  },
  {
    title: "One link clients actually finish.",
    body: "Text, audio, or video in under 60 seconds — no Loom, no downloads, no forms they abandon. Collection handled, so you can focus on using it.",
  },
  {
    title: "Feather-light embed + one flat price.",
    body: "A fast widget that won't tank your Lighthouse score. No per-seat or per-view surprises — one price, everything included.",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">ProofRecall</span>
        <nav className="flex items-center gap-4 text-sm">
          <a
            href="/login"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Log in
          </a>
          <a
            href="#waitlist"
            className="rounded-full bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Join the waitlist
          </a>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-3xl px-6 pt-12 pb-16 text-center">
        <p className="mb-4 text-sm font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Recall the perfect testimonial before every call
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Find the right testimonial in 5 seconds — before every sales call.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Stop digging through folders, screenshots, and DMs before every sales
          call. ProofRecall collects testimonials with one simple link clients
          actually finish — then organizes every quote so the right one surfaces
          in seconds.
        </p>
        <div id="waitlist" className="mt-8 flex flex-col items-center gap-3">
          <a
            href="#"
            className="rounded-full bg-zinc-900 px-6 py-3 text-base font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Join the waitlist → get free early access
          </a>
          <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            Built for sellers who already have testimonials — and are tired of
            digging for them. Free while in beta. No card required.
          </p>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-6 px-6 pb-20 sm:grid-cols-3">
        {bullets.map((b) => (
          <div
            key={b.title}
            className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800"
          >
            <h2 className="text-base font-semibold">{b.title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {b.body}
            </p>
          </div>
        ))}
      </section>

      <footer className="border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        © {new Date().getFullYear()} ProofRecall · Day 1 skeleton — the waitlist
        form lands later.
      </footer>
    </main>
  );
}
