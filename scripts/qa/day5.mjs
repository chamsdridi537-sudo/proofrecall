/**
 * Day 5 QA — the objection-first entry and the copy-with-attribution artifact.
 *
 * Day 4 proved you can get quotes *in*. This proves the other half: that a
 * seller who remembers only what the prospect said can get the right one *out*,
 * and leave the tool with something usable in one click.
 *
 *   node scripts/qa/day5.mjs
 *
 * Run after seed-day3.mjs (alice's and bob's fixture libraries) and, for the
 * attribution check on CSV-sourced rows, after csv-day4.mjs (carol's five).
 *
 * The chip terms are re-typed here on purpose rather than imported from
 * `src/lib/objections.ts`. These scripts run on plain `node` with no build step,
 * so importing a `.ts` file is not available to them — and that accident is
 * useful: if someone edits the app's list and forgets the fixtures can no longer
 * answer it, this script goes red instead of quietly agreeing with itself.
 */

import {
  QA_USERS,
  app,
  brief,
  createChecks,
  renderedText,
  signIn,
  ssrCookie,
} from "./lib.mjs";

const checks = createChecks();

const CHIPS = [
  { said: "It's too expensive", query: "pricing or expensive" },
  { said: "What's the payback, honestly?", query: "roi or paid" },
  { said: "Rollouts always slip here", query: "onboarding or migration" },
  { said: "We're mid-contract with someone else", query: "contract or vendor" },
  { said: "Security will never approve it", query: "security or procurement" },
  { said: "Nobody on our team will use it", query: "activation or team" },
];

/** Every chip has to retrieve, or the row of buttons is decoration. */
const MIN_DAY = 5;

async function main() {
  const aliceSession = await signIn(QA_USERS.alice);
  const aliceCookie = ssrCookie(aliceSession);
  const bobSession = await signIn(QA_USERS.bob);
  const bobCookie = ssrCookie(bobSession);
  console.log("[auth] alice + bob signed in");

  // --- 1. the deploy marker moved -------------------------------------------
  // Not `=== 5`: day6.mjs pins its own marker, and this suite has to stay
  // runnable against a build that ships both features.
  const health = await app("/api/health");
  checks.check(
    `health reports day ${MIN_DAY} or later`,
    Number(health.json?.day ?? 0) >= MIN_DAY,
    JSON.stringify(health.json),
  );

  // --- 1b. the landing page sells the thing we actually built ----------------
  // Day 5 rewrote the homepage around the objection moment. What matters here is
  // not that the prose is nice — it is that the page no longer advertises the
  // collection link and the embed widget, which do not exist, and that the one
  // phrase the whole positioning hangs on survived the rewrite.
  const home = await app("/");
  const homeCopy = renderedText(home.text);
  checks.check("landing page 200", home.status === 200, String(home.status));
  checks.check(
    "the anchor phrase is still on the page",
    homeCopy.includes("find the right testimonial in 5 seconds"),
    "hero subhead lost the phrase in the rewrite",
  );
  checks.check(
    "the H1 opens on the objection, not the stopwatch",
    homeCopy.includes("Answer the objection while they"),
    brief(homeCopy.match(/<h1[^>]*>([\s\S]{0,120})/)?.[1] ?? "no h1", 120),
  );
  for (const unBuilt of [
    "One link clients actually finish",
    "Feather-light embed",
    "no Loom, no downloads",
  ]) {
    checks.check(
      `the page does not advertise something unbuilt: “${unBuilt}”`,
      !homeCopy.includes(unBuilt),
    );
  }
  // The footer shipped promising a waitlist form "later". Day 6 replaced it with
  // what is true now, so assert both halves: the new line is there, the old one
  // is not.
  checks.check(
    "the footer states the current price, not a placeholder",
    homeCopy.includes("Free while in beta."),
    brief(homeCopy.match(/<footer[^>]*>([\s\S]{0,160})/)?.[1] ?? "no footer", 160),
  );
  checks.check(
    "the footer no longer says the page is a skeleton",
    !homeCopy.includes("Day 1 skeleton"),
  );

  // --- 2. the chips are in the HTML that first paints ------------------------
  const dash = await app("/dashboard", { cookie: aliceCookie });
  checks.check("dashboard 200", dash.status === 200, String(dash.status));
  checks.check(
    "the objection row is labelled as one thing, not six loose buttons",
    dash.text.includes('aria-label="Search by the objection you just heard"'),
  );
  checks.check("the framing copy is on the page", dash.text.includes("They said"));
  // `&#x27;` is what React sends for the apostrophe in three of the six labels.
  // Comparing decoded markup means this check tests the copy, not the escaping.
  const seen = renderedText(dash.text);
  for (const chip of CHIPS) {
    checks.check(
      `chip renders: “${chip.said}”`,
      seen.includes(chip.said) && seen.includes(`Find proof against “${chip.said}”`),
      "label or aria-label missing",
    );
    // A chip displays the objection and searches the union, which means the
    // query is no longer visible in the search box. The tooltip is what keeps
    // `or` discoverable instead of magic, so it is part of the feature and is
    // asserted as such — same capital OR the app renders.
    const phrase = chip.query.replace(/\s+or\s+/i, " OR ");
    checks.check(
      `chip tooltip shows what it searches: “${chip.said}” → Searched: ${phrase}`,
      dash.text.includes(`title="Searched: ${phrase}"`),
      "tooltip missing — the union would be hidden",
    );
  }

  // --- 3. every chip's term actually retrieves through the real path ---------
  for (const chip of CHIPS) {
    const found = await app(
      `/api/search?q=${encodeURIComponent(chip.query)}&limit=5`,
      { cookie: aliceCookie },
    );
    const rows = found.json?.results ?? [];
    const tier = found.json?.match_kind ?? null;
    checks.check(
      `“${chip.said}” → “${chip.query}” finds a quote`,
      rows.length > 0,
      `${rows.length} rows, tier=${tier}`,
    );
    // A chip that only works because it fell back to "newest first" is not
    // answering the objection, it is hiding the fact.
    checks.check(
      `“${chip.query}” matched on content, not recency`,
      rows.length === 0 || tier !== "recent",
      `tier=${tier}`,
    );
  }

  // --- 4. RLS still holds across all six entries -----------------------------
  for (const chip of CHIPS) {
    const [mine, theirs] = await Promise.all([
      app(`/api/search?q=${encodeURIComponent(chip.query)}&limit=25`, { cookie: aliceCookie }),
      app(`/api/search?q=${encodeURIComponent(chip.query)}&limit=25`, { cookie: bobCookie }),
    ]);
    const aliceIds = new Set((mine.json?.results ?? []).map((row) => row.id));
    const overlap = (theirs.json?.results ?? []).filter((row) => aliceIds.has(row.id));
    checks.check(
      `“${chip.query}” returns no shared ids between tenants`,
      overlap.length === 0,
      `${overlap.length} shared`,
    );
  }

  // --- 5. the attribution line, asserted from the server-rendered markup -----
  // The payload lives in `data-copy`, so what a click puts on the clipboard is
  // the same string this check can read. No browser, no clipboard permissions,
  // no trusting the handler to agree with the test.
  //
  // The attributes are read out of the raw markup and each payload decoded
  // afterwards: decoding the whole document first would turn an escaped quote
  // inside a payload into a real `"` and break the extraction it came from.
  const copied = [...dash.text.matchAll(/data-copy="([^"]*)"/g)].map((m) =>
    renderedText(m[1]),
  );
  checks.check(
    "every result row carries a copy button",
    copied.length > 0 && dash.text.includes('aria-label="Copy this quote with attribution"'),
    `${copied.length} payloads found`,
  );
  checks.check(
    "attribution is quote, em dash, author, role, company",
    copied.includes(
      "“They cut our onboarding time in half, and the pricing page finally converts — the ROI showed up in the first month.” — Marta Kowalski, Head of Growth, Northwind Labs",
    ),
    brief(copied[0] ?? "none", 120),
  );
  checks.check(
    "the pasted-back shape matches what the importer writes (— Author, Role, Company)",
    copied.every((line) => !line.includes("undefined") && !line.includes(", ,")),
  );
  checks.check(
    "a copy button appears once per row",
    copied.length === (dash.text.match(/aria-label="Copy this quote with attribution"/g) ?? []).length,
  );

  console.log(`[copy] first payload: ${brief(copied[0] ?? "none", 120)}`);
  checks.exitOnFailure();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
