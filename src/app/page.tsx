const bullets = [
  {
    title: "Start from what they said.",
    body: "Tap “It's too expensive” or “Security will never approve it” and get back the quotes that changed someone's mind about exactly that. Half-remembered phrasing and typos included — that's the whole point.",
  },
  {
    title: "Copy it, attribution attached.",
    body: "One click puts the quote on your clipboard with its author, role and company still welded on, so what you paste into Slack, a deck or a reply carries the credit that makes it land.",
  },
  {
    title: "One flat price. And it stays yours.",
    body: "No per-seat or per-view surprises as your team grows. Every library is isolated in the database itself, so your customers' words never appear in another company's results.",
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
          Proof, not memory
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Answer the objection while they’re still on the line.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          ProofRecall holds every testimonial you have ever collected, so you
          find the right testimonial in 5 seconds — starting from what the
          prospect actually said, not from the folder you saved it in.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          The proof is already yours. It is in a Gmail thread, a Slack message,
          and a spreadsheet someone maintained in 2023. Import it once, and the
          next time a deal hangs on whether a team like theirs ever adopted
          something like this, you have the quote — name, role, company attached
          — before the silence gets awkward.
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
