# ProofRecall

> **Find the right testimonial in 5 seconds — before every sales call.**
> *Recall the perfect testimonial before every call.*

ProofRecall collects client testimonials with one simple link clients actually
finish (text / audio / video), then organizes every quote so the right one
surfaces in seconds. The moat is **retrieval**, not collection: sellers already
have testimonials — they're tired of digging for them.

---

## Stack

| Layer          | Choice                                   | Why (this product)                                   |
| -------------- | ---------------------------------------- | ---------------------------------------------------- |
| Frontend       | Next.js 16 (App Router) + TypeScript     | Landing (SEO/ISR) + authed search UI + light embed    |
| Styling        | Tailwind CSS v4                           | Fast, consistent UI                                   |
| Backend / DB   | Supabase (Postgres + Auth + RLS + Storage)| Paywall + limits enforced in the DB, not the client   |
| Search         | Postgres full-text (`tsvector` + `pg_trgm`)| Retrieval moat at $0; `pgvector` later for semantic  |
| Payments       | Lemon Squeezy (Merchant of Record)        | Works from Tunisia (Stripe/Paddle do not); handles VAT|
| Email          | Resend                                    | Free tier covers transactional mail                   |
| Analytics      | PostHog                                   | Free product analytics + session replay + flags       |
| Errors         | Sentry                                    | Catch failed payment/webhook events                   |
| Hosting        | Vercel Hobby (→ Cloudflare Pages fallback)| Free; builds in the cloud. See "Hosting note" below   |

## Getting started (local dev)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local   # then fill in real Supabase values (Day 2)

# 3. Run the dev server
npm run dev                  # http://localhost:3000
```

Useful checks:

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

Health endpoint: `GET /api/health` → `{ "status": "ok", ... }`.

## Routes

- `/` — landing page (objection-first copy, approved; footer reads "Free while in beta.")
- `/login` — Supabase Auth sign-in / sign-up
- `/auth/callback`, `/auth/confirm`, `/auth/signout` — the OAuth-style email link handoff
- `/dashboard` — protected. Search box, the six objection chips (they display what
  the prospect said and search the synonym union behind it, with the union in a
  tooltip), tag filter, paste-a-batch and CSV import, and "Copy with attribution"
- `/api/health` — liveness probe; its `day` field is the deploy marker
- `/api/search` — the three retrieval tiers (browse / full-text / trigram), RLS-scoped
- `/api/testimonials` — list and paste-import
- `/api/import/csv/analyze`, `/api/import/csv/commit` — column mapping, then per-row import
- `/api/debug/rls` — the cross-tenant tripwire the keep-warm cron calls. **Deleted on launch day.**

## Environment variables

See [`.env.example`](./.env.example). Rules we follow:

- **Never** commit real secrets. `.env*` is git-ignored **except** `.env.example`.
- The Supabase **anon key is not a secret** — it is safe in the browser *only
  because* Row Level Security (RLS) gates every query. RLS is on from Day 2.
- The Supabase **service-role key is server-only** and must never reach the client.
- On Vercel, set env vars in **Project → Settings → Environment Variables**.

## Deploying (Vercel)

Recommended path that avoids any local toolchain issues — **GitHub → Vercel**:

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repo (framework auto-detected: Next.js).
3. Add the env vars from `.env.example` (placeholders are fine for Day 1).
4. Deploy → live at `https://proofrecall.vercel.app`.

Every push builds in Vercel's cloud, so the build is verified even without a
local `node_modules`.

### Hosting note (budget rule: $0 fixed cost until first revenue)

We launch on **Vercel Hobby** (free) at `proofrecall.vercel.app`. Vercel's
Hobby plan is **non-commercial use only** per their fair-use policy; a public
pricing page is the gray area. Enforcement is reactive, not automatic. If Vercel
ever flags the project, we migrate same-day to **Cloudflare Pages** (free,
commercial allowed). We do **not** buy a custom domain or upgrade to Vercel Pro
until there is at least one paying customer.

## Roadmap (30-day plan)

- **Day 1** — skeleton + always-green deploy *(this commit)*
- **Day 2** — Supabase Auth + profile + RLS foundation
- **Day 3** — testimonials schema + storage + "add existing testimonial"
- **Day 4** — public collection link (text)
- **Day 5** — audio/video submission + moderation
- **Day 6** — 🏆 tagging + **search** (the moat)
- **Day 7** — buffer + first user tests
- **Day 8** — feather-light embed widget
- **Day 9** — Lemon Squeezy checkout + server-side paywall (DB/RLS)
- **Day 10** — signature-verified, idempotent webhooks + tests
- **Day 11** — Resend email (welcome, new testimonial, trial-ending, receipt)
- **Day 12** — landing + pricing + waitlist→convert
- **Day 13** — onboarding (import existing → send first link → embed)
- **Day 14** — rate limiting, Sentry, legal pages, customer portal, custom-domain readiness

## Known local-env caveat

On the original dev machine, **Avast/AVG SSL scanning** breaks Node's TLS to the
npm registry (`ERR_SSL_WRONG_VERSION_NUMBER`) and locks files during install
(`EPERM`). Workarounds: add an AV exclusion for `node.exe` / the npm registry,
or temporarily disable "HTTPS scanning" / Web Shield, then re-run `npm install`.
Cloud builds (Vercel / GitHub Actions) are unaffected.
