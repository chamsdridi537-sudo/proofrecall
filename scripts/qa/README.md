# QA scripts

Plain `.mjs`, run with the `node` on your PATH. No build step, no package
install, no TypeScript loader — these have to work on a machine where
`npm install` is broken, because they are the part of the testing that touches
production.

Nothing here holds a secret. The Supabase URL and the **publishable (anon) key**
are read from `.env.local` at the repo root (already gitignored) or from the
environment. No script reads or accepts the `service_role` key: every call is
made with a normal user's session, so row level security filters them exactly
like it filters a customer.

## One-time setup: three throwaway tenants

The scripts need three accounts because proving isolation requires more than one
owner. Email confirmation is on, so the public signup form cannot produce a
session for a script — create them directly:

**Supabase dashboard → Authentication → Users → Add user**, tick *Auto Confirm*,
and use these emails (or override them in the environment):

| User   | Default email              | Purpose                                            |
| ------ | -------------------------- | -------------------------------------------------- |
| alice  | `alice.day5qa@example.com` | seeded library, paste-import target                |
| bob    | `bob.day5qa@example.com`   | second library, same words, proves RLS             |
| carol  | `carol.day5qa@example.com` | left empty, so CSV tests start from a clean tenant |

*Auto Confirm* has to be ticked on each one: email confirmation is still on in
this project (it gets switched off at launch week), and a script cannot click a
confirmation link. Passwords are arbitrary; they only ever exist in
`.env.local`.

```sh
export QA_ALICE_EMAIL=alice.day5qa@example.com
export QA_ALICE_PASSWORD='…'
export QA_BOB_EMAIL=bob.day5qa@example.com
export QA_BOB_PASSWORD='…'
export QA_CAROL_EMAIL=carol.day5qa@example.com
export QA_CAROL_PASSWORD='…'
export APP_URL=https://proofrecall.vercel.app   # optional, this is the default
```

The same names can live in `.env.local` at the repo root instead — `lib.mjs`
reads that file (it is gitignored) before falling back to the environment, so the
passwords stay out of your shell history and off every command line.

## Running

In this order — later scripts assert against what the earlier ones seeded:

```sh
node scripts/qa/seed-day3.mjs    # database layer: search tiers + RLS, via PostgREST
node scripts/qa/app-day4.mjs     # app layer: the deployed Next routes + dashboard HTML
node scripts/qa/csv-day4.mjs     # CSV upload, duplicate guard, empty state, tag chips
node scripts/qa/day5.mjs         # objection chips + copy-with-attribution + landing copy
node scripts/qa/day6.mjs after   # "or" retrieval, against scripts/qa/out/day6-before.json
node scripts/qa/latency.mjs      # warm retrieval budget (<1s), and the cold-start delta
```

Each exits non-zero on the first failed assertion and prints `ALL GREEN` or
`NOT GREEN`. `csv-day4.mjs` wipes carol's own library before it starts, so both
it and the paste-import test are safe to re-run.

`day6.mjs` is the one script with a mode, and it is not re-runnable in the usual
way. A change to the retrieval function is only worth believing if you can show
what it did *before*, so `node scripts/qa/day6.mjs before` captures the live
behaviour into `scripts/qa/out/day6-before.json` and must be run **once, while the
old function is still deployed**. After the migration, `after` re-runs the same
queries and diffs against that file: the union law holds, and every single-word
result set is identical to the snapshot. Once the cutover has happened the
"before" capture cannot be reproduced — the state it describes no longer exists —
which is why the file is gitignored evidence for one run rather than a fixture.

## Teardown

```sh
node scripts/qa/teardown.mjs     # wipes all three libraries, as each tenant
```

It signs in as each QA user, calls the same wipe the tests use, and then checks
from the outside that the tenant really has zero rows and finds zero results for
queries it used to match. Because it runs as a user, that proof is RLS-scoped —
so follow it with the global count as the dashboard role, which sees every row
regardless of owner:

The scripts only ever write as a QA user, so clearing up for good is deleting
those users: **Supabase → Authentication → Users**, per tenant. The foreign keys
cascade their `testimonials`, `tags` and `testimonial_tags` rows.

Run this in the SQL editor to confirm both facts at once — that nothing is left,
and that the duplicate-quote guard survived the whole exercise:

```sql
do $$
declare t bigint; g bigint; l bigint; p bigint; u bigint; h integer; i bigint;
begin
  select count(*) into t from public.testimonials;
  select count(*) into g from public.tags;
  select count(*) into l from public.testimonial_tags;
  select count(*) into p from public.profiles;
  select count(*) into u from auth.users;
  select count(*) into h from information_schema.columns
    where table_schema = 'public' and table_name = 'testimonials'
      and column_name = 'quote_hash';
  select count(*) into i from pg_indexes
    where schemaname = 'public' and tablename = 'testimonials'
      and indexname = 'testimonials_user_quote_hash_key';
  raise exception 'VERIFY t=% g=% l=% profiles=% users=% quote_hash_col=% uniq_idx=%',
    t, g, l, p, u, h, i;
end $$;
```

`raise exception`, not `raise notice`: the dashboard renders neither the results
grid nor notices, so a notice-only probe comes back as "Success. No rows
returned" and proves nothing. An exception's message is the only channel this UI
reliably shows. Expected output after teardown is
`t=0 g=0 l=0`, with `quote_hash_col=1 uniq_idx=1`.

## What each script proves

- **`seed-day3.mjs`** — the retrieval contract at the database: `"pricing"`
  matches through the full-text tier, `"prcing"` still finds it through the
  trigram tier, a word nobody owns matches nothing, an anonymous key sees zero
  rows, and no id from one tenant appears in another's results.
- **`app-day4.mjs`** — the same behaviour through the real routes: the health
  marker, the search limit, the tag filter, `GET /api/testimonials`, the
  paste-a-batch import writing twice-zero, and the dashboard HTML actually
  containing the search box, the CSV picker, server-rendered quotes and tag
  chips. Plus the unauthenticated matrix: the API returns 401 and `/dashboard`
  redirects.
- **`csv-day4.mjs`** — the Day 4 surface: the empty state in the first HTML,
  analyze describing a semicolon file with a quoted comma and an embedded
  newline, the suggested mapping, `imported 5 / duplicates 1 / errors 1` with
  the right row numbers, a re-import that writes nothing, tags parsed from three
  different cell styles, the uploaded quotes then being searchable (exact and
  typo), and carol's rows invisible to alice.
- **`day5.mjs`** — the retrieval promise from the seller's side: all six objection
  chips are in the server-rendered HTML, each chip's term returns at least one row
  through `/api/search` and on a content tier rather than recency, no two tenants
  share a result id for any of the six, and the copy payload in `data-copy` is
  exactly `“quote” — Author, Role, Company` with no dangling commas. It also reads
  the landing page: the anchor phrase "find the right testimonial in 5 seconds"
  survived the copy rewrite, the H1 still opens on the objection, and nothing on
  the page advertises the collection link or the embed widget, because neither is
  built. Since Day 6 the chips display the prospect's words and search the union
  underneath, so this script also requires each chip's tooltip to spell out what
  it searches (`Searched: pricing OR expensive`) — an operator nobody can see is
  not a feature — and requires the footer to say "Free while in beta." instead of
  the old Day 1 skeleton line.
- **`day6.mjs`** — one search meaning "either of these". For each chip pair: the
  two words never match the same quote (so the union is a real widening), the union
  law holds exactly, it arrives on the full-text tier, at least four of the six
  chips answer with more than either word alone, a bare multi-word query is still
  ANDed, quoted phrases and `-exclusion` work, and RLS survives the new operator.
  In `before` mode it asserts the opposite — that the union was unreachable by
  content — so the test is known to be capable of failing.
- **`latency.mjs`** — the product promise is a number: warm searches inside a
  second at the median and at p75, with no more than one sample in five over
  budget and the in-route Postgres time fast at the median. p95, max and the
  cold-start delta are printed either way, because on a free tier the tail is
  infrastructure jitter and the honest thing is to watch it rather than average
  it away. It also counts how often the route's 400 ms hedge had to fire.
- **`teardown.mjs`** — the run order's last step: after wiping each tenant, its
  own `testimonials`, `tags` and `testimonial_tags` counts read zero and
  `search_testimonials` returns nothing for words it just matched, so a stale row
  cannot be mistaken for a passing test tomorrow.
