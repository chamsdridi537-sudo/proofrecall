/**
 * Day 4 QA — CSV upload, duplicate guard, empty state, tag chips.
 *
 * Everything here goes through the *deployed app* (Vercel) with a real session
 * cookie, so it exercises the Next routes, `@supabase/ssr`, RLS and Postgres
 * together — not a local copy of the logic. The tenant is carol, who starts
 * empty, so the first-run empty state and the row counts are deterministic no
 * matter how often this runs.
 *
 *   node scripts/qa/csv-day4.mjs
 *
 * Safe to re-run: it wipes carol's library first (RLS confines the deletes to
 * her own rows) and the duplicate guard makes a repeat import a no-op.
 */

import {
  QA_USERS,
  app,
  brief,
  createChecks,
  rest,
  signIn,
  ssrCookie,
  wipeLibrary,
} from "./lib.mjs";
import { CSV_UPLOAD } from "./fixtures.mjs";

const checks = createChecks();
const mapping = {
  quote: 0,
  author: 1,
  author_role: 2,
  author_company: 3,
  source: 4,
  tags: 5,
};

function csvForm(extra = {}) {
  const form = new FormData();
  form.append("file", new File([CSV_UPLOAD], "qa-export.csv", { type: "text/csv" }));
  for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
  return form;
}

async function main() {
  const carolSession = await signIn(QA_USERS.carol);
  const carol = carolSession.access_token;
  const carolCookie = ssrCookie(carolSession);
  const aliceSession = await signIn(QA_USERS.alice);
  const aliceCookie = ssrCookie(aliceSession);
  console.log("[auth] carol + alice signed in");

  await wipeLibrary(carol);

  // --- 1. the empty library must be visible in the HTML that first paints ----
  const before = await app("/dashboard", { cookie: carolCookie });
  checks.check("dashboard renders 200", before.status === 200, String(before.status));
  checks.check(
    "empty state is server-rendered",
    before.text.includes("Your library is empty"),
    "no such text in the SSR HTML",
  );
  checks.check(
    "empty state teaches the search box",
    before.text.includes("the right quote comes back, even if you mistype it"),
  );

  // --- 2. analyze: describe the file and suggest a mapping -------------------
  const analyzed = await app("/api/import/csv/analyze", {
    method: "POST",
    cookie: carolCookie,
    form: csvForm(),
  });
  checks.check("analyze 200", analyzed.status === 200, `${analyzed.status} ${analyzed.text.slice(0, 200)}`);
  const a = analyzed.json ?? {};
  console.log(`[analyze] ${a.columns?.length} cols, ${a.totalRows} rows, header=${a.hasHeader}, delim-detected`);
  checks.check("analyze sees 6 columns", a.columns?.length === 6, JSON.stringify(a.columns));
  checks.check("analyze reads the header row", a.hasHeader === true);
  checks.check("analyze counts 7 data rows", a.totalRows === 7, String(a.totalRows));
  checks.check(
    "suggested mapping is the real one",
    JSON.stringify(a.suggestedMapping) === JSON.stringify(mapping),
    JSON.stringify(a.suggestedMapping),
  );
  checks.check("analyze echoes the file name", a.fileName === "qa-export.csv", a.fileName);
  checks.check(
    "analyze keeps quoted-newline rows in one cell",
    (a.preview ?? []).some((row) => String(row[0] ?? "").includes("It all lands")),
    JSON.stringify(a.preview),
  );

  // --- 3. commit: per-row reporting, then the duplicate guard ----------------
  const first = await app("/api/import/csv/commit", {
    method: "POST",
    cookie: carolCookie,
    form: csvForm({ mapping: JSON.stringify(mapping), hasHeader: true }),
  });
  checks.check("commit 201", first.status === 201, `${first.status} ${first.text.slice(0, 200)}`);
  const f = first.json ?? {};
  console.log(
    `[commit] imported=${f.imported} duplicates=${JSON.stringify(f.duplicates)} errors=${JSON.stringify(f.errors)}`,
  );
  checks.check("5 of 7 rows imported", f.imported === 5, JSON.stringify(f));
  checks.check("in-file repeat reported as row 4", f.duplicates?.length === 1 && f.duplicates[0].row === 4, JSON.stringify(f.duplicates));
  checks.check(
    "in-file repeat is the whitespace/case variant",
    /pricing wall/i.test(f.duplicates?.[0]?.excerpt ?? ""),
    f.duplicates?.[0]?.excerpt,
  );
  checks.check("empty-quote row reported as row 6", f.errors?.length === 1 && f.errors[0].row === 6, JSON.stringify(f.errors));
  checks.check("totalRows reported", f.totalRows === 7, String(f.totalRows));

  // Same file again: nothing new, and every row now names the library as the
  // reason. 6 duplicates = 5 already-stored + 1 in-file repeat.
  const second = await app("/api/import/csv/commit", {
    method: "POST",
    cookie: carolCookie,
    form: csvForm({ mapping: JSON.stringify(mapping), hasHeader: true }),
  });
  const s = second.json ?? {};
  console.log(`[re-commit] imported=${s.imported} duplicates=${s.duplicates?.length}`);
  checks.check("re-import writes nothing", s.imported === 0, JSON.stringify(s));
  checks.check("re-import lists 6 library duplicates", s.duplicates?.length === 6, JSON.stringify(s.duplicates));
  checks.check(
    "re-import says why",
    (s.duplicates ?? []).filter((d) => /already in your library/i.test(d.reason)).length === 5,
    JSON.stringify(s.duplicates),
  );

  // --- 4. what actually landed in Postgres ----------------------------------
  const rows = await rest("testimonials?select=quote,author,author_role,source&order=created_at.asc", {
    token: carol,
  });
  checks.check("library holds 5 rows", rows.length === 5, String(rows.length));
  checks.check(
    "quoted newline stayed one quote",
    rows.filter((r) => /It all lands/.test(r.quote)).length === 1 &&
      rows.some((r) => /Slack threads\.\nIt all lands/.test(r.quote)),
    JSON.stringify(rows.map((r) => brief(r.quote, 40))),
  );
  checks.check(
    "author columns mapped per row",
    rows.some((r) => r.author === "Dana Whitfield" && r.author_role === "Head of Ops" && r.source === "email"),
    JSON.stringify(rows.map((r) => [r.author, r.author_role, r.source])),
  );

  const tagRows = await rest("tags?select=name&order=name.asc", { token: carol });
  const linkRows = await rest("testimonial_tags?select=testimonial_id,tag_id", { token: carol });
  const tagNames = tagRows.map((t) => t.name).sort();
  console.log(`[tags] ${tagNames.join(", ")} (${linkRows.length} links)`);
  checks.check(
    "tags parsed from comma, # and quoted cells",
    ["onboarding", "pain-points", "pricing", "reliability", "reporting", "roi", "speed", "support"].every((n) =>
      tagNames.includes(n),
    ) && tagNames.length === 8,
    JSON.stringify(tagNames),
  );
  checks.check("8 quote/tag links written", linkRows.length === 8, String(linkRows.length));

  // --- 5. retrieval over the uploaded library -------------------------------
  const ledger = await app("/api/search?q=ledger&limit=5", { cookie: carolCookie });
  const ledgerBody = ledger.json ?? {};
  console.log(`[search:ledger] ${JSON.stringify((ledgerBody.results ?? []).map((r) => brief(r.quote, 40)))}`);
  checks.check("ledger search hits", (ledgerBody.results ?? []).length === 1, JSON.stringify(ledgerBody).slice(0, 200));
  checks.check("ledger hit is an exact word match", ledgerBody.results?.[0]?.match_kind === "fts", ledgerBody.results?.[0]?.match_kind);

  const typo = await app("/api/search?q=prcing", { cookie: carolCookie });
  const typoBody = typo.json ?? {};
  console.log(`[search:prcing] ${JSON.stringify((typoBody.results ?? []).map((r) => [r.match_kind, brief(r.quote, 34)]))}`);
  checks.check("typo finds the pricing quote", (typoBody.results ?? []).length >= 1);
  checks.check("typo arrives by trigram", typoBody.results?.[0]?.match_kind === "trigram", typoBody.results?.[0]?.match_kind);
  checks.check("typo top hit is the right quote", /pricing wall/i.test(typoBody.results?.[0]?.quote ?? ""));

  const noise = await app("/api/search?q=xylophonequartz", { cookie: carolCookie });
  checks.check("noise word returns nothing", (noise.json?.results ?? []).length === 0, JSON.stringify(noise.json?.results));

  // --- 6. cross-tenant invisibility -----------------------------------------
  // Carol owns "ledger"; alice owns nothing that mentions it. Neither sees the
  // other's words, and neither sees a word only the other could match.
  const aliceLedger = await app("/api/search?q=ledger", { cookie: aliceCookie });
  checks.check("alice cannot find carol's ledger quote", (aliceLedger.json?.results ?? []).length === 0, JSON.stringify(aliceLedger.json?.results ?? []));
  const carolChurn = await app("/api/search?q=churn", { cookie: carolCookie });
  checks.check("carol cannot find bob's churn quote", (carolChurn.json?.results ?? []).length === 0);
  const carolDirect = await rest("testimonials?select=id&limit=100", { token: carol });
  const aliceMine = await rest("testimonials?select=id&limit=100", { token: aliceSession.access_token });
  const carolIds = new Set(carolDirect.map((r) => r.id));
  checks.check(
    "no shared row ids between tenants",
    aliceMine.filter((r) => carolIds.has(r.id)).length === 0,
    `alice=${aliceMine.length} carol=${carolDirect.length}`,
  );

  // --- 7. the dashboard after import: rows, chips, no empty state -----------
  const after = await app("/dashboard", { cookie: carolCookie });
  checks.check(
    "imported quote is server-rendered",
    after.text.includes("The pricing wall came down once finance saw the ledger audit."),
    "quote missing from SSR HTML",
  );
  checks.check("empty state gone after import", !after.text.includes("Your library is empty"));
  checks.check(
    "tag chips render on result rows",
    after.text.includes('aria-label="Filter by tag'),
    "no tag chip in the HTML",
  );
  checks.check("csv uploader is on the page", after.text.includes("Upload a CSV of testimonials"));

  checks.exitOnFailure();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
