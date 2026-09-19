/**
 * Day 6 QA — `or` means `or`, and nothing else moved.
 *
 *   node scripts/qa/day6.mjs before    # run against the OLD function (plainto)
 *   node scripts/qa/day6.mjs after     # run against websearch_to_tsquery
 *
 * Two modes because the interesting claim is a *comparison*: "security or
 * procurement" has to bring back the security quote AND the procurement quote,
 * where before it brought back one of them by accident. A test that only asserts
 * the new behaviour cannot tell you the old behaviour was broken, so this script
 * writes a snapshot of what the live function returns (`scripts/qa/out/`) and the
 * second run diffs itself against it.
 *
 * What "after" proves, in order of how much it would hurt to get wrong:
 *   1. The union law. For every chip pair, search("a or b") returns exactly the
 *      rows search("a") and search("b") return together. Not a superset, not a
 *      subset — exactly, which is what `|` means.
 *   2. Single words are untouched. Every one-word result list in "after" is
 *      identical to the same list in "before", which is the property the whole
 *      migration rests on: no query that worked yesterday changes shape today.
 *   3. TheAND control. "a b" (no operator) still behaves like "a AND b" — the
 *      migration did not quietly widen every multi-word search.
 *   4. Phrases and exclusions, the two other things `websearch` brings: "in
 *      half" as a phrase, and `pricing -invoice` as an exclusion.
 *   5. RLS. All of it still confined to the caller's own rows.
 *
 * The chip pairs are read out of `src/lib/objections.ts` rather than re-typed
 * here, because that file is what the product actually sends and a second copy
 * would drift the first time someone reworded a chip.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { QA_USERS, app, brief, createChecks, renderedText, signIn, ssrCookie } from "./lib.mjs";

const checks = createChecks();
const MODE = process.argv[2] === "after" ? "after" : "before";
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_FILE = join(HERE, "..", "..", "src", "lib", "objections.ts");
const SNAPSHOT_DIR = join(HERE, "out");
/** What the live function returned before the migration — read by "after". */
const PRIOR_SNAPSHOT = join(SNAPSHOT_DIR, "day6-before.json");

/** Pull `{ said, query }` out of the TypeScript source with no build step. */
async function readObjections() {
  const src = renderedText(await readFile(SOURCE_FILE, "utf8"));
  const pairs = [];
  const re = /said:\s*"([^"]+)",\s*query:\s*"([^"]+)"/g;
  for (const m of src.matchAll(re)) {
    const terms = m[2].split(/\s+or\s+/i).map((t) => t.trim()).filter(Boolean);
    if (terms.length === 2) pairs.push({ said: m[1], query: m[2], terms });
  }
  return pairs;
}

const idsOf = (rows) => rows.map((r) => r.id);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function search(cookie, q) {
  const found = await app(`/api/search?q=${encodeURIComponent(q)}&limit=25`, { cookie });
  return { ids: idsOf(found.json?.results ?? []), tier: found.json?.match_kind ?? null, rows: found.json?.results ?? [] };
}

async function main() {
  const chips = await readObjections();
  checks.check("six objection chips parsed from the app source", chips.length === 6, `got ${chips.length}`);
  if (chips.length !== 6) checks.exitOnFailure();

  const aliceCookie = ssrCookie(await signIn(QA_USERS.alice));
  const bobCookie = ssrCookie(await signIn(QA_USERS.bob));
  const health = await app("/api/health");
  const day = Number(health.json?.day ?? 0);
  console.log(`[${MODE}] deployed build reports day ${day}`);
  checks.check(
    MODE === "after" ? "health has moved to day 6" : "health is at day 5 or later",
    MODE === "after" ? day === 6 : day >= 5,
    JSON.stringify(health.json),
  );

  const snapshot = { mode: MODE, day, takenAt: new Date().toISOString(), chips: [] };
  /** How many chips got a strictly bigger answer than either word alone. */
  let widened = 0;

  for (const chip of chips) {
    const [one, two] = chip.terms;
    const [a, b, or, and, bobOr] = await Promise.all([
      search(aliceCookie, one),
      search(aliceCookie, two),
      search(aliceCookie, chip.query),
      search(aliceCookie, `${one} ${two}`),
      search(bobCookie, chip.query),
    ]);
    const union = [...new Set([...a.ids, ...b.ids])];
    snapshot.chips.push({
      said: chip.said,
      terms: chip.terms,
      query: chip.query,
      one: a.ids, oneTier: a.tier,
      two: b.ids, twoTier: b.tier,
      or: or.ids, orTier: or.tier,
      and: and.ids, andTier: and.tier,
      bobOr: bobOr.ids,
    });

    const label = `“${chip.said}”`;
    console.log(
      `[${MODE}] ${label} → ${one}=${a.ids.length}(${a.tier}) ${two}=${b.ids.length}(${b.tier}) ` +
        `or=${or.ids.length}(${or.tier}) and=${and.ids.length}(${and.tier}) union=${union.length}`
    );
    if (or.ids.length > Math.max(a.ids.length, b.ids.length)) widened += 1;

    // The fixture premise that makes this pair worth testing: the two words never
    // appear in the same quote, so neither one alone can produce the union. If it
    // ever stops holding, the union law below becomes a weaker statement about a
    // pair that only one word already answers, and this is the check that says so.
    //
    // (The first draft of this check asserted the AND query returned *no rows*.
    // Wrong, and the run said so: a full-text miss falls through to the trigram
    // tier, which happily answers "roi paid" by similarity. Disjoint hits and a
    // non-fts AND are the properties that actually matter.)
    checks.check(
      `${label}: “${one}” and “${two}” never match the same quote`,
      a.ids.filter((id) => b.ids.includes(id)).length === 0,
      `${a.ids.length} x ${b.ids.length} rows overlap`,
    );
    checks.check(
      `${label}: “${one} ${two}” together is not a full-text match`,
      and.tier !== "fts",
      `tier=${and.tier} with ${and.ids.length} rows`,
    );
    // RLS holds across the operator, in both modes.
    checks.check(
      `${label}: alice's and bob's “${chip.query}” sets never share a row`,
      or.ids.filter((id) => bobOr.ids.includes(id)).length === 0,
    );

    if (MODE === "after") {
      // 1. the union law — the point of the whole exercise.
      checks.check(
        `${label}: “${chip.query}” returns exactly the union of “${one}” and “${two}”`,
        sameSet(or.ids, union) && or.ids.length > 0,
        `or=${or.ids.length} union=${union.length}`,
      );
      checks.check(`${label}: the union came from the full-text tier`, or.tier === "fts", `tier=${or.tier}`);
      checks.check(
        `${label}: the union contains both words' own hits`,
        a.ids.every((id) => or.ids.includes(id)) && b.ids.every((id) => or.ids.includes(id)),
      );
    } else {
      // 2. the defect, live. Under `plainto` the two words are ANDed, so the
      //    full-text tier cannot answer the pair at all and anything on screen
      //    arrived by trigram similarity.
      //
      //      Deliberately *not* compared on row count: on two of the six pairs
      //      the trigram tier happens to hand back the full union anyway, which
      //      is exactly how this stayed invisible — the numbers looked right
      //      while nothing was matching on content. The tier is the honest
      //      signal, and it is the same reason day5.mjs refuses to accept
      //      "matched on recency" for a chip.
      checks.check(
        `${label}: plainto cannot reach the union by full text (defect is live)`,
        or.tier !== "fts",
        `tier=${or.tier} with ${or.ids.length}/${union.length} rows — nothing to fix, which means this snapshot proves nothing`,
      );
    }
  }

  if (MODE === "after") {
    checks.check(
      "at least four of the six chips retrieve strictly more than either word alone",
      widened >= 4,
      `only ${widened}`,
    );

    // 3. the one-word behaviour the migration promised not to disturb.
    let prior;
    try {
      prior = JSON.parse(await readFile(PRIOR_SNAPSHOT, "utf8"));
    } catch {
      console.error(
        "ERROR: scripts/qa/out/day6-before.json is missing, and it cannot be\n" +
          "re-created now — `before` describes the live function, so it only has a\n" +
          "meaning while plainto_tsquery is still deployed. Recover it from the\n" +
          "cutover session's output, or drop the identical-single-word checks by\n" +
          "hand and note that this run did not prove them.",
      );
      process.exit(1);
    }
    checks.check(
      "the before-snapshot is the same six chips",
      prior.chips?.length === snapshot.chips.length &&
        prior.chips.every((c, i) => c.query === snapshot.chips[i].query),
      "the chips changed between the two runs — re-run `before` first",
    );
    for (const [i, chip] of snapshot.chips.entries()) {
      const was = prior.chips[i];
      checks.check(
        `single-word results unchanged: “${chip.terms[0]}” / “${chip.terms[1]}”`,
        sameSet(was.one, chip.one) && sameSet(was.two, chip.two),
        `${was.one.length}+${was.two.length} before → ${chip.one.length}+${chip.two.length} after`,
      );
    }

    // 4. the two other things websearch buys us, on the seeded library.
    const phrase = await search(aliceCookie, '"in half"');
    checks.check(
      'a quoted phrase searches as a phrase: “"in half"”',
      phrase.ids.length > 0 && /in half/i.test(phrase.rows[0]?.quote ?? ""),
      `${phrase.ids.length} rows, tier=${phrase.tier}`,
    );
    const excluded = await search(aliceCookie, "pricing -invoice");
    const plain = await search(aliceCookie, "pricing");
    checks.check(
      "a minus word excludes: “pricing -invoice” is pricing without the invoice quote",
      excluded.ids.length > 0 &&
        excluded.ids.length < plain.ids.length &&
        excluded.ids.every((id) => plain.ids.includes(id)),
      `${excluded.ids.length} vs ${plain.ids.length}`,
    );
  }

  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(join(SNAPSHOT_DIR, `day6-${MODE}.json`), JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`[${MODE}] snapshot written to scripts/qa/out/day6-${MODE}.json`);
  checks.exitOnFailure();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
