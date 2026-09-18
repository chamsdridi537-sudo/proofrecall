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
| alice  | `alice.day4qa@example.com` | seeded library, paste-import target                |
| bob    | `bob.day4qa@example.com`   | second library, same words, proves RLS             |
| carol  | `carol.day4qa@example.com` | left empty, so CSV tests start from a clean tenant |

Passwords are arbitrary; they only ever exist in your shell environment.

```sh
export QA_ALICE_EMAIL=alice.day4qa@example.com
export QA_ALICE_PASSWORD='…'
export QA_BOB_EMAIL=bob.day4qa@example.com
export QA_BOB_PASSWORD='…'
export QA_CAROL_EMAIL=carol.day4qa@example.com
export QA_CAROL_PASSWORD='…'
export APP_URL=https://proofrecall.vercel.app   # optional, this is the default
```

## Running

In this order — later scripts assert against what the earlier ones seeded:

```sh
node scripts/qa/seed-day3.mjs    # database layer: search tiers + RLS, via PostgREST
node scripts/qa/app-day4.mjs     # app layer: the deployed Next routes + dashboard HTML
node scripts/qa/csv-day4.mjs     # CSV upload, duplicate guard, empty state, tag chips
node scripts/qa/latency.mjs      # warm retrieval budget (<1s), and the cold-start delta
```

Each exits non-zero on the first failed assertion and prints `ALL GREEN` or
`NOT GREEN`. `csv-day4.mjs` wipes carol's own library before it starts, so both
it and the paste-import test are safe to re-run.

## Teardown

The scripts only ever write as a QA user, so clearing up is deleting those
users: **Supabase → Authentication → Users**, per tenant. The foreign keys
cascade their `testimonials`, `tags` and `testimonial_tags` rows. To be sure
nothing is left, run this in the SQL editor and check the counts are all zero:

```sql
do $$
declare t bigint; g bigint; l bigint;
begin
  select count(*) into t from public.testimonials;
  select count(*) into g from public.tags;
  select count(*) into l from public.testimonial_tags;
  raise notice 'CLEANUP t=% g=% l=%', t, g, l;
end $$;
```

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
- **`latency.mjs`** — the product promise is a number: warm searches median and
  worst case under a second, the in-route Postgres time under 500 ms, and the
  cold-start overhead reported separately so it stays visible instead of
  hiding inside an average.
