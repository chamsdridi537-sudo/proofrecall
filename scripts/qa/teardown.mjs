/**
 * Day 4 QA — teardown.
 *
 * Wipes every row the three QA tenants own and proves it twice: once from inside
 * each tenant (an owner can only see and delete their own rows, so a zero here
 * says their library is empty), and once by retrieval — after the wipe, a word
 * that used to hit must return nothing, which is the same call a customer's
 * dashboard makes.
 *
 *   node scripts/qa/teardown.mjs
 *
 * Deleting the three auth users themselves is a dashboard action (Authentication
 * → Users → Delete). It is optional: with zero rows they hold nothing, and the
 * next QA run re-seeds them.
 */

import {
  QA_USERS,
  createChecks,
  rest,
  signIn,
  wipeLibrary,
} from "./lib.mjs";

const checks = createChecks();
const PROBES = ["pricing", "onboarding", "ledger"];

async function main() {
  for (const which of ["alice", "bob", "carol"]) {
    const session = await signIn(QA_USERS[which]);
    const token = session.access_token;

    const before = await rest("testimonials?select=id", { token });
    await wipeLibrary(token);

    const rows = await rest("testimonials?select=id", { token });
    const tags = await rest("tags?select=id", { token });
    const links = await rest("testimonial_tags?select=testimonial_id", { token });
    console.log(
      `[cleanup] ${which}: had ${before.length} quotes -> testimonials=${rows.length} tags=${tags.length} links=${links.length}`,
    );
    checks.check(`${which}'s library is empty`, rows.length === 0 && tags.length === 0 && links.length === 0);

    // Retrieval over an empty tenant: the tiers have nothing left to find.
    for (const query of PROBES) {
      const found = await rest("rpc/search_testimonials", {
        method: "POST",
        token,
        body: { query },
      });
      checks.check(`${which} finds nothing for "${query}"`, found.length === 0, `${found.length} rows`);
    }
  }

  checks.check("all three tenants were processed", true);
  console.log("\nReminder: delete the QA users in Supabase → Authentication → Users");
  console.log("to drop their auth + profile rows too; the SQL in README.md proves the");
  console.log("whole database is empty.\n");
  checks.exitOnFailure();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
