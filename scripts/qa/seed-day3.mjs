/**
 * Database-layer retrieval + RLS test (Day 3, kept current).
 *
 * Talks to PostgREST directly, not to the app, so a failure here means the
 * schema, the ranking function or the policies changed — not a UI bug.
 *
 *   node scripts/qa/seed-day3.mjs
 *
 * It is idempotent: each run wipes the caller's own rows first, then re-seeds.
 */

import {
  ANON_KEY,
  QA_USERS,
  brief,
  createChecks,
  rest,
  signIn,
} from "./lib.mjs";
import { FIXTURES } from "./fixtures.mjs";

const checks = createChecks();

async function seed(which) {
  const token = tokens[which];
  const items = FIXTURES[which];

  await rest("testimonials?id=gte.00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    token,
  });
  await rest("tags?id=gte.00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    token,
  });

  const rows = await rest("testimonials", {
    method: "POST",
    token,
    headers: { Prefer: "return=representation" },
    body: items.map(({ tags, ...rest_ }) => rest_),
  });

  const names = [...new Set(items.flatMap((item) => item.tags))];
  await rest("tags?on_conflict=user_id,name", {
    method: "POST",
    token,
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: names.map((name) => ({ name })),
  });
  const tagRows = await rest(`tags?select=id,name&name=in.(${names.join(",")})`, { token });

  const idByQuote = new Map(rows.map((row) => [row.quote, row.id]));
  const idByTag = new Map(tagRows.map((row) => [row.name, row.id]));
  const links = [];
  for (const item of items) {
    const testimonial_id = idByQuote.get(item.quote);
    for (const tag of item.tags) {
      const tag_id = idByTag.get(tag);
      if (testimonial_id && tag_id) links.push({ testimonial_id, tag_id });
    }
  }
  await rest("testimonial_tags", {
    method: "POST",
    token,
    headers: { Prefer: "return=representation" },
    body: links,
  });

  console.log(
    `[seed] ${which}: ${rows.length} quotes, ${tagRows.length} tags, ${links.length} links`,
  );
  return rows.map((row) => row.id);
}

async function search(label, token, args) {
  const started = Date.now();
  const rows = await rest("rpc/search_testimonials", {
    method: "POST",
    token,
    body: args,
  });
  const ms = Date.now() - started;
  console.log(`\n[${label}] ${JSON.stringify(args)} -> ${rows.length} rows in ${ms}ms`);
  for (const row of rows.slice(0, 3)) {
    console.log(
      `  · [${row.match_kind ?? "-"}] rank=${
        row.rank == null ? "-" : Number(row.rank).toFixed(4)
      } tags=${(row.tags ?? []).join(",") || "-"} | ${brief(row.quote)} (${row.author})`,
    );
  }
  return { rows, ms };
}

const sessions = {
  alice: await signIn(QA_USERS.alice),
  bob: await signIn(QA_USERS.bob),
};
const tokens = {
  alice: sessions.alice.access_token,
  bob: sessions.bob.access_token,
};
console.log("[auth] both QA accounts signed in");

const aliceIds = new Set(await seed("alice"));
const bobIds = new Set(await seed("bob"));

const pricing = await search("pricing/alice", tokens.alice, { query: "pricing" });
const typo = await search("prcing/alice", tokens.alice, { query: "prcing" });
const bobPricing = await search("pricing/bob", tokens.bob, { query: "pricing" });
const bobTypo = await search("prcing/bob", tokens.bob, { query: "prcing" });
const byTag = await search("tag=pricing/alice", tokens.alice, { query: null, tag_name: "pricing" });
const otherTag = await search("tag=churn/alice", tokens.alice, { query: null, tag_name: "churn" });
const browse = await search("browse/alice", tokens.alice, { query: null });
const noise = await search("zebra/alice", tokens.alice, { query: "zebra" });

const leakIntoAlice = [...pricing.rows, ...typo.rows, ...byTag.rows]
  .map((row) => row.id)
  .filter((id) => bobIds.has(id));
const leakIntoBob = [...bobPricing.rows, ...bobTypo.rows]
  .map((row) => row.id)
  .filter((id) => aliceIds.has(id));

const anonRpc = await rest("rpc/search_testimonials", {
  method: "POST",
  token: ANON_KEY,
  body: { query: "pricing" },
});
const anonTable = await rest("testimonials?select=id&limit=5", { token: ANON_KEY });
console.log(`\n[anon] rpc rows=${anonRpc.length} table rows=${anonTable.length}`);

for (const which of ["alice", "bob"]) {
  const mine = await rest("testimonials?select=id", { token: tokens[which] });
  checks.check(`${which} reads only their own ${FIXTURES[which].length} rows`, mine.length === FIXTURES[which].length, `saw ${mine.length}`);
}

console.log("\n[assertions]");
checks.check("pricing answers in under a second", pricing.ms < 1000, `${pricing.ms}ms`);
checks.check("pricing top hit is about pricing", /pricing/i.test(pricing.rows[0]?.quote ?? ""), brief(pricing.rows[0]?.quote));
checks.check("pricing used the full-text tier", pricing.rows[0]?.match_kind === "fts", String(pricing.rows[0]?.match_kind));
checks.check("typo 'prcing' still returns rows", typo.rows.length > 0);
checks.check("typo used the trigram tier", typo.rows[0]?.match_kind === "trigram", String(typo.rows[0]?.match_kind));
checks.check("typo top hit is the pricing quote", /pricing/i.test(typo.rows[0]?.quote ?? ""), brief(typo.rows[0]?.quote));
checks.check("the same typo works for a second tenant", bobTypo.rows[0]?.match_kind === "trigram" && /pricing/i.test(bobTypo.rows[0]?.quote ?? ""));
checks.check("tag filter returns only tagged rows", byTag.rows.length > 0 && byTag.rows.every((r) => (r.tags ?? []).includes("pricing")));
checks.check("a tag the user does not have returns nothing", otherTag.rows.length === 0, `${otherTag.rows.length} rows`);
checks.check("browsing returns the whole library", browse.rows.length === FIXTURES.alice.length, `${browse.rows.length} rows`);
checks.check("a word nobody used returns nothing", noise.rows.length === 0, `${noise.rows.length} rows`);
checks.check("alice never receives bob's rows", leakIntoAlice.length === 0, JSON.stringify(leakIntoAlice));
checks.check("bob never receives alice's rows", leakIntoBob.length === 0, JSON.stringify(leakIntoBob));
checks.check("anonymous sees nothing", anonRpc.length === 0 && anonTable.length === 0);

checks.exitOnFailure();
