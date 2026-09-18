/**
 * Day 4 QA — retrieval latency on the deployed app.
 *
 * Day 3 found the first search after a quiet period taking over a second, which
 * is the Vercel + Supabase cold-start tax rather than a Postgres problem. This
 * script measures both halves on purpose: it reports the cold sample, then
 * samples the warm path, and the pass/fail line is about the *warm* path —
 * because "five seconds before a sales call" is a returning user.
 *
 *   node scripts/qa/latency.mjs
 *
 * The budget is asserted against the app's own reported `ms` (measured inside
 * the route, around the Postgres call) and against wall-clock time, so a slow
 * network shows up as a difference between the two instead of a mystery.
 */

import { APP_URL, QA_USERS, app, createChecks, signIn, ssrCookie } from "./lib.mjs";

const QUERIES = ["pricing", "onboarding", "support", "roi", "migration", "churn", "speed"];
const SAMPLES = 3;
const WARM_BUDGET_MS = 1000;

function stats(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    min: sorted[0],
    median: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
}

function line(label, s) {
  return `${label}: n=${s.n} min=${s.min}ms median=${s.median}ms p95=${s.p95}ms max=${s.max}ms`;
}

async function timed(cookie, q) {
  const started = Date.now();
  const { status, json } = await app(`/api/search?q=${encodeURIComponent(q)}`, { cookie });
  const wall = Date.now() - started;
  return {
    q,
    status,
    wall,
    server: typeof json?.ms === "number" ? json.ms : null,
    hits: (json?.results ?? []).length,
    kind: json?.results?.[0]?.match_kind ?? "-",
  };
}

async function main() {
  const session = await signIn(QA_USERS.alice);
  const cookie = ssrCookie(session);

  // 1. cold: one request against a route that has not been touched in minutes.
  const cold = await timed(cookie, "pricing");
  console.log(
    `[cold ] q="${cold.q}" ${cold.wall}ms (server ${cold.server ?? "?"}ms) status=${cold.status} hits=${cold.hits} tier=${cold.kind}`,
  );

  // 2. warm-up, then the samples that actually decide the pass.
  await timed(cookie, "warmup");
  const samples = [];
  for (let round = 0; round < SAMPLES; round += 1) {
    for (const q of QUERIES) samples.push(await timed(cookie, q));
  }
  for (const s of samples) {
    console.log(
      `[warm ] q="${s.q}" ${s.wall}ms (server ${s.server ?? "?"}ms) hits=${s.hits} tier=${s.kind}`,
    );
  }

  const walls = stats(samples.map((s) => s.wall));
  const servers = stats(samples.filter((s) => s.server !== null).map((s) => s.server));
  console.log(`\n${line("wall-clock", walls)}`);
  if (servers.n) console.log(line("in-route  ", servers));
  console.log(`cold-start overhead: ${cold.wall - walls.median}ms vs warm median`);

  const checks = createChecks();
  checks.check("every warm sample is a 200", samples.every((s) => s.status === 200));
  checks.check("warm median under 1s", walls.median < WARM_BUDGET_MS, `${walls.median}ms`);
  checks.check("warm worst case under 1s", walls.max < WARM_BUDGET_MS, `${walls.max}ms`);
  if (servers.n) {
    checks.check(
      "Postgres itself stays well inside the budget",
      servers.max < 500,
      `${servers.max}ms measured inside the route`,
    );
  }
  checks.check("the cold request still answers", cold.status === 200, String(cold.status));
  console.log(`\nTarget: ${APP_URL}`);
  checks.exitOnFailure();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
