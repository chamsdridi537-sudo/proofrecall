/**
 * Deployed-app test: the Next routes and the dashboard HTML, as a signed-in
 * user would hit them.
 *
 *   node scripts/qa/app-day4.mjs
 *
 * Authentication uses the `@supabase/ssr` cookie that lib.mjs builds from a real
 * session, which is what the browser sends — the route handlers read cookies,
 * not an Authorization header, so a bearer token would only prove that
 * PostgREST works.
 *
 * Run scripts/qa/seed-day3.mjs first: some assertions compare the app's answers
 * with the seeded fixtures.
 */

import {
  APP_URL,
  QA_USERS,
  brief,
  createChecks,
  app,
  signIn,
  ssrCookie,
} from "./lib.mjs";
import { FIXTURES } from "./fixtures.mjs";

const checks = createChecks();

const aliceSession = await signIn(QA_USERS.alice);
const bobSession = await signIn(QA_USERS.bob);
const alice = ssrCookie(aliceSession);
const bob = ssrCookie(bobSession);

// 1. health is the deploy oracle
{
  const { status, json } = await app("/api/health");
  checks.check("GET /api/health is 200", status === 200, String(status));
  checks.check("health reports day 4", json?.day === 4, JSON.stringify(json));
}

// 2. search through the app, correctly spelled
{
  const { status, json } = await app("/api/search?q=pricing&limit=5", { cookie: alice });
  checks.check("GET /api/search is 200", status === 200, String(status));
  checks.check("search returns alice's pricing quotes", (json?.results ?? []).length > 0);
  checks.check("first result is about pricing", /pricing/i.test(json?.results?.[0]?.quote ?? ""), brief(json?.results?.[0]?.quote));
  checks.check("search reports the fts tier", json?.results?.[0]?.match_kind === "fts", String(json?.results?.[0]?.match_kind));
  checks.check("limit is honoured", (json?.results ?? []).length <= 5);
  const aliceIds = new Set(FIXTURES.alice.map((item) => brief(item.quote, 40)));
  const leaked = (json?.results ?? []).filter((row) => !aliceIds.has(brief(row.quote, 40)));
  checks.check("no foreign rows in alice's results", leaked.length === 0, leaked.map((r) => brief(r.quote, 40)).join(" | "));
}

// 3. the typo path through the app
{
  const { json } = await app("/api/search?q=prcing", { cookie: alice });
  checks.check("typo returns results through the app", (json?.results ?? []).length > 0);
  checks.check("typo used the trigram tier", json?.results?.[0]?.match_kind === "trigram", String(json?.results?.[0]?.match_kind));
}

// 4. tag filter through the app
{
  const { json } = await app("/api/search?tag=pricing", { cookie: alice });
  checks.check("tag filter returns tagged rows only", (json?.results ?? []).length > 0 && (json?.results ?? []).every((r) => (r.tags ?? []).includes("pricing")));
  const bobSeen = await app("/api/search?tag=churn", { cookie: alice });
  checks.check("alice cannot filter by a tag only bob owns", (bobSeen.json?.results ?? []).length === 0, JSON.stringify(bobSeen.json?.results?.length));
}

// 5. browsing the library
{
  const { json } = await app("/api/testimonials?limit=50", { cookie: bob });
  checks.check("GET /api/testimonials returns bob's library", (json?.results ?? []).length === FIXTURES.bob.length, `${json?.results?.length} rows`);
}

// 6. paste-a-batch, then the same batch again (Day 4 duplicate guard)
const PASTE = `"A CSV export is not a library. ProofRecall turned ours into something the sales team actually opens." — Iris Chen, Head of Sales, Halcyon #csv #sales\n"The five-second search changed how we run call prep." — Ben Oyelaran, RevOps, Trellis #sales #speed`;
{
  const first = await app("/api/testimonials", { method: "POST", cookie: alice, body: { raw: PASTE } });
  const again = await app("/api/testimonials", { method: "POST", cookie: alice, body: { raw: PASTE } });

  // Run-once: two new rows, then zero. Run-twice: the guard already holds them,
  // so the first call reports the duplicates instead. Either way the guard is
  // what the assertion is about.
  const fresh = first.json?.imported === 2 && again.json?.imported === 0;
  const rerun = first.json?.imported === 0 && again.json?.imported === 0;
  checks.check("paste import wrote 2 then 0", fresh || rerun, JSON.stringify({ first: first.json, again: again.json }));
  checks.check("paste responses are 201", first.status === 201 && again.status === 201, `${first.status}/${again.status}`);
  checks.check("re-pasted rows are reported as duplicates", (again.json?.duplicates ?? []).length === 2, JSON.stringify(again.json?.duplicates));

  const searchable = await app("/api/search?q=Halcyon", { cookie: alice });
  checks.check("an imported quote is searchable", (searchable.json?.results ?? []).length > 0);
}

// 7. the dashboard, as HTML — including the first page, which the Server
//    Component now fetches so a returning visitor never sees a spinner
{
  const { status, text } = await app("/dashboard", { cookie: alice });
  checks.check("GET /dashboard is 200 for a signed-in user", status === 200, String(status));
  checks.check("dashboard renders the search box", text.includes('aria-label="Search testimonials"'));
  checks.check("dashboard renders the CSV picker", text.includes("Upload a CSV"), "missing the CSV heading");
  checks.check("dashboard renders the file input", text.includes('aria-label="Upload a CSV of testimonials"'));
  checks.check("dashboard offers the paste importer", text.includes("Add testimonials"));
  checks.check(
    "library is server-rendered on first paint",
    text.includes("They cut our onboarding time in half"),
    "no seeded quote in the SSR HTML",
  );
  checks.check(
    "tag chips are rendered buttons",
    text.includes('aria-label="Filter by tag'),
    "no chip in the SSR HTML",
  );
  checks.check(
    "a tenant with rows never sees the empty state",
    !text.includes("Your library is empty"),
  );
}

// 8. unauthenticated access is refused, per route
{
  const search = await app("/api/search?q=pricing");
  checks.check("anonymous /api/search is 401", search.status === 401, String(search.status));
  checks.check("anonymous /api/search body says unauthenticated", search.json?.error === "unauthenticated", search.text.slice(0, 120));
  const list = await app("/api/testimonials");
  checks.check("anonymous /api/testimonials GET is 401", list.status === 401, String(list.status));
  const write = await app("/api/testimonials", { method: "POST", body: { raw: "x" } });
  checks.check("anonymous /api/testimonials POST is 401", write.status === 401, String(write.status));
  const csvAnalyze = await app("/api/import/csv/analyze", { method: "POST", form: new FormData() });
  checks.check("anonymous csv analyze is 401", csvAnalyze.status === 401, String(csvAnalyze.status));
  const dash = await app("/dashboard");
  checks.check("anonymous /dashboard redirects to /login", dash.status === 307 && (dash.headers.get("location") ?? "").includes("/login"), `${dash.status} ${dash.headers.get("location")}`);
}

console.log(`\nTarget: ${APP_URL}`);
checks.exitOnFailure();
