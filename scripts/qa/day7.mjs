/**
 * Day 7 QA — the first-run coach and the three analytics events, proven
 * from the outside.
 *
 *   node scripts/qa/day7.mjs
 *
 * Run after `seed-day3.mjs` and *before* `csv-day4.mjs`: half of this suite
 * reads carol's dashboard, and her teaching value depends on her library
 * still being empty.
 *
 * What a headless script can and cannot see, it says out loud:
 *   - The numbered empty state lives in the server HTML → asserted directly.
 *   - The pulse lives in client state (localStorage) → the script asserts the
 *     *contract* instead: the hook attribute is in the markup, the client-only
 *     hint is provably NOT in the server HTML (an SSR-rendered hint would be a
 *     hydration mismatch waiting to happen), and the keyframe exists in the
 *     shipped stylesheet. The animation itself is a browser check.
 *   - The PostHog snippet is injected after paint, so no page HTML ever
 *     mentions it. Without a key the whole layer must be silent, and silence
 *     is assertable; with a key, event delivery is a browser-network check.
 */

import { QA_USERS, app, createChecks, renderedText, signIn, ssrCookie } from "./lib.mjs";

const checks = createChecks();

const EMPTY_STATE_LINES = [
  "three steps to the first win",
  "Bring what you already have.",
  "Ask with the objection.",
  "Leave with the proof.",
];

async function main() {
  const aliceCookie = ssrCookie(await signIn(QA_USERS.alice));
  const carolCookie = ssrCookie(await signIn(QA_USERS.carol));
  console.log("[auth] alice + carol signed in");

  // --- 1. the deploy marker moved -------------------------------------------
  const health = await app("/api/health");
  const day = Number(health.json?.day ?? 0);
  checks.check("health reports day 7 or later", day >= 7, JSON.stringify(health.json));
  checks.check(
    "health says whether analytics is configured, without saying the key",
    typeof health.json?.posthog_configured === "boolean",
    JSON.stringify(health.json),
  );

  const configured = Boolean(health.json?.posthog_configured);
  console.log(
    configured
      ? "[posthog] key present in this build — delivery is verified in the browser (network tab / MCP), not here"
      : "[posthog] no key — the whole suite doubles as the silence test",
  );

  // --- 2. alice: the coach's contract, not its animation ----------------------
  const dash = await app("/dashboard", { cookie: aliceCookie });
  checks.check("alice's dashboard 200", dash.status === 200, String(dash.status));
  checks.check(
    "the chip row carries the coach's test hook",
    dash.text.includes('data-coach-target="objection-chips"'),
  );
  // The hint appears only for a device whose localStorage has no flag — a fact
  // the server cannot know. If any of it leaked into the HTML, hydration would
  // disagree with itself, so its absence is the correct assertion.
  checks.check(
    "the coached hint is NOT in the server HTML",
    !dash.text.includes("data-coach-hint"),
  );
  checks.check(
    "the pulse class is NOT baked into the server HTML",
    !dash.text.includes("coach-pulse"),
  );
  // A first-time visitor with a full library must not also be shown the
  // new-account lesson — the two teachers pick one lane each.
  const aliceCopy = renderedText(dash.text);
  for (const line of EMPTY_STATE_LINES) {
    checks.check(`a non-empty library does not show the empty-state step “${line}”`, !aliceCopy.includes(line));
  }

  // --- 3. carol: the lesson is in the first paint, not behind a fetch --------
  const empty = await app("/dashboard", { cookie: carolCookie });
  checks.check("carol's dashboard 200", empty.status === 200, String(empty.status));
  const carolCopy = renderedText(empty.text);
  for (const line of EMPTY_STATE_LINES) {
    checks.check(
      `empty state teaches “${line}”`,
      carolCopy.includes(line),
      "the numbered steps did not survive the deploy",
    );
  }
  // carol must still get the chips — step 2 promises them; the coach is a
  // pointer, not a permission gate.
  checks.check(
    "carol still sees the objection row (the teacher does not hide the tool)",
    empty.text.includes('aria-label="Search by the objection you just heard"'),
  );

  // --- 4. the shipped stylesheet actually carries the pulse -------------------
  // A class name with no keyframe behind it is a silent no-op, and no local
  // build exists to catch that — so the CSS file the page links is fetched and
  // read, exactly as the browser would.
  const cssHref = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css[^"]*)"/.exec(dash.text)?.[1];
  checks.check("the dashboard links a stylesheet", Boolean(cssHref), "no link tag found");
  if (cssHref) {
    const css = await app(cssHref);
    checks.check("the stylesheet 200s", css.status === 200, String(css.status));
    checks.check(
      "the coach-pulse keyframe ships",
      css.text.includes("@keyframes coach-pulse"),
    );
    checks.check(
      "the pulse honours prefers-reduced-motion",
      /prefers-reduced-motion[^}]*\{[^}]*coach-pulse/.test(css.text.replace(/\s+/g, " ")),
    );
  }

  // --- 5. the `searched` event's props are real, measurable things -----------
  // The event carries { hits, tier, chip }. The first two are answers the API
  // already returns — this asserts those answers exist and are typed, so a
  // rename in the response shape breaks here rather than in the PostHog board.
  const found = await app("/api/search?q=pricing%20or%20expensive&limit=25", { cookie: aliceCookie });
  const hit = found.json?.results?.length ?? -1;
  checks.check("a chip query returns rows", hit > 0, `${hit} rows`);
  checks.check(
    "the response carries a tier the event could report",
    ["recent", "fts", "trigram"].includes(found.json?.match_kind ?? ""),
    `match_kind=${found.json?.match_kind}`,
  );
  const miss = await app("/api/search?q=pricing&limit=25", { cookie: carolCookie });
  checks.check(
    "a real miss reports as zero hits, not an error (events must count misses too)",
    miss.status === 200 && Array.isArray(miss.json?.results) && miss.json.results.length === 0,
    `${miss.status} / ${JSON.stringify(miss.json).slice(0, 120)}`,
  );

  // --- 6. the front door still locks ------------------------------------------
  const anon = await app("/dashboard");
  checks.check(
    "anonymous /dashboard is redirected, not rendered",
    anon.status >= 300 && anon.status < 400,
    String(anon.status),
  );

  // --- 7. silence-by-design ----------------------------------------------------
  // With no key the app must not reference PostHog anywhere a script can see:
  // no page HTML mentions it, and the health flag says false. (The loader lives
  // in a JS chunk either way; what is asserted is that it never *runs* — that
  // is the SSR-visible half.)
  if (!configured) {
    const home = await app("/");
    checks.check("landing HTML never mentions posthog", !home.text.toLowerCase().includes("posthog"));
    checks.check("dashboard HTML never mentions posthog", !dash.text.toLowerCase().includes("posthog"));
  }

  checks.exitOnFailure();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
