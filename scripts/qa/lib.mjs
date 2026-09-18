/**
 * Shared plumbing for the QA scripts. Plain JavaScript on purpose: these run
 * with `node scripts/qa/x.mjs` and must not need a build step, a package
 * install, or a TS loader.
 *
 * Nothing secret is hard-coded. The Supabase URL and the publishable (anon) key
 * are read from the environment or from `.env.local`, exactly like the app
 * reads them at build time.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readDotEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/i.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return out;
}

const dotEnv = readDotEnv();
const value = (name) => process.env[name] ?? dotEnv[name];

export const SUPABASE_URL = value("NEXT_PUBLIC_SUPABASE_URL");
export const ANON_KEY = value("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const APP_URL = (value("APP_URL") ?? "https://proofrecall.vercel.app").replace(/\/$/, "");

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Put them in .env.local at the repo root, or export them in the shell.",
  );
  process.exit(1);
}

/**
 * The three throwaway accounts these scripts sign in with. They must be created
 * in the Supabase dashboard with "auto confirm" ticked — email confirmation is
 * on, so a public signup never returns a session. See scripts/qa/README.md.
 *
 * alice and bob hold the overlapping fixture libraries used to prove isolation;
 * carol is left empty so the CSV upload and the first-run empty state always
 * start from a clean tenant.
 */
export const QA_USERS = {
  alice: {
    email: value("QA_ALICE_EMAIL") ?? "alice.day4qa@example.com",
    password: value("QA_ALICE_PASSWORD") ?? "Replace-me-Alice-2026",
  },
  bob: {
    email: value("QA_BOB_EMAIL") ?? "bob.day4qa@example.com",
    password: value("QA_BOB_PASSWORD") ?? "Replace-me-Bob-2026",
  },
  carol: {
    email: value("QA_CAROL_EMAIL") ?? "carol.day4qa@example.com",
    password: value("QA_CAROL_PASSWORD") ?? "Replace-me-Carol-2026",
  },
};

/** Sign in with a password and return the whole token response (see `ssrCookie`). */
export async function signIn(user) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `Sign in failed for ${user.email} (${res.status}): ${JSON.stringify(body)}. ` +
        "Create the QA users in the dashboard with auto-confirm first.",
    );
  }
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Statuses that mean "not processed, ask again" rather than "your test is wrong". */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_BACKOFF_MS = 400;

/**
 * One call to PostgREST with the caller's own access token, so RLS applies.
 *
 * GETs get one retry. On 2026-09-18 a `seed-day3` run died on a transport error
 * partway through, which left two tenants empty and made `app-day4.mjs` report
 * two false failures on the very next script — a suite that flakes once in
 * twenty is a suite that gets ignored, so the retry is load-bearing for the
 * suite's credibility, not for Postgres's.
 *
 * Writes deliberately get zero. A request that dies *after* the server received
 * it would replay on retry, and while an insert here is protected by the unique
 * `(user_id, quote_hash)` index from migration 0003 and the wipes are idempotent,
 * a silently duplicated fixture row would weaken exactly the isolation tests it
 * exists to prove. If a write ever needs retrying, give it an idempotency key
 * first rather than a loop.
 */
export async function rest(
  path,
  { method = "GET", body, token, headers = {}, retries = method === "GET" ? 1 : 0 } = {},
) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt);

    let res = null;
    let text = "";
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      text = await res.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) continue;
      throw new Error(`${method} ${path} never got a response: ${lastError.message}`);
    }

    if (res.ok) return text ? JSON.parse(text) : null;

    const message = `${method} ${path} -> ${res.status} ${text.slice(0, 400)}`;
    if (attempt < retries && TRANSIENT_STATUSES.has(res.status)) {
      lastError = new Error(message);
      continue;
    }
    throw new Error(message);
  }

  throw lastError ?? new Error(`${method} ${path} failed`);
}

/**
 * `@supabase/ssr` stores the session in one cookie named
 * `sb-<project-ref>-auth-token`, whose value is "base64-" plus the base64 of the
 * token endpoint's JSON. Sending it lets these scripts hit the *deployed* Next
 * routes as a signed-in user without a browser — the routes read cookies, not
 * an Authorization header.
 */
export function ssrCookie(session) {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64");
  return `sb-${ref}-auth-token=${"base64-" + encoded}`;
}

/** One call to the deployed app, authenticated by that cookie when given. */
export async function app(
  path,
  { method = "GET", cookie, body, headers = {}, form } = {},
) {
  const isForm = form instanceof FormData;
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(isForm ? {} : body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: isForm ? form : body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* HTML or an empty body — callers get `text` anyway. */
  }
  return { status: res.status, text, json, headers: res.headers };
}

/** A tiny assertion collector so every script ends the same way. */
export function createChecks() {
  const results = [];
  return {
    check(name, pass, detail = "") {
      results.push({ name, pass: Boolean(pass), detail });
      if (!pass) console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
      return Boolean(pass);
    },
    report(title) {
      const failed = results.filter((r) => !r.pass);
      console.log(`\n[${title}] ${results.length - failed.length}/${results.length} passed`);
      for (const r of results.filter((x) => x.pass)) console.log(`  PASS  ${r.name}`);
      if (failed.length) {
        for (const r of failed) console.log(`  FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
        console.log(`\n${title}: NOT GREEN`);
        return false;
      }
      console.log(`\n${title}: ALL GREEN`);
      return true;
    },
    exitOnFailure() {
      if (!this.report("qa")) process.exit(1);
    },
  };
}

/** Shorten a quote for log lines. */
export function brief(text, length = 72) {
  const cleaned = String(text ?? "").replace(/\s+/g, " ");
  return cleaned.length > length ? `${cleaned.slice(0, length)}…` : cleaned;
}

/** Delete every row the caller owns — RLS keeps it inside their own tenant. */
export async function wipeLibrary(token) {
  await rest("testimonial_tags?testimonial_id=gte.00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    token,
  }).catch(() => null);
  await rest("testimonials?id=gte.00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    token,
  });
  await rest("tags?id=gte.00000000-0000-0000-0000-000000000000", { method: "DELETE", token });
}
