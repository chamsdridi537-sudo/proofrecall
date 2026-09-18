/**
 * Fixture libraries for the QA scripts (Day 3 onwards).
 *
 * Deliberately two tenants with overlapping vocabulary — "pricing" appears in
 * both libraries — because the only way to prove RLS on a retrieval endpoint is
 * to ask both users for the same word and show that neither gets the other's
 * rows. Every quote is invented; none of it is a real customer's text.
 */

export const FIXTURES = {
  alice: [
    {
      quote:
        "They cut our onboarding time in half, and the pricing page finally converts — the ROI showed up in the first month.",
      author: "Marta Kowalski",
      author_role: "Head of Growth",
      author_company: "Northwind Labs",
      source: "email",
      tags: ["pricing", "onboarding", "roi"],
    },
    {
      quote:
        "New users reach their first project in under four minutes now. Activation stopped being a guessing game.",
      author: "Daniel Osei",
      author_role: "Product Manager",
      author_company: "Kite Analytics",
      source: "linkedin",
      tags: ["onboarding", "activation"],
    },
    {
      quote:
        "Their team answered our escalation at 2am on a Sunday. That is not vendor behaviour, that is partnership.",
      author: "Priya Raman",
      author_role: "VP Customer Experience",
      author_company: "Lumen Health",
      source: "call",
      tags: ["support", "reliability"],
    },
    {
      quote:
        "We recovered 22% of abandoned trials in the first quarter — I now open every board deck with that number.",
      author: "Tomás Ferreira",
      author_role: "CEO",
      author_company: "Brightloom",
      source: "form",
      tags: ["results", "case-study"],
    },
    {
      quote:
        "Pricing felt high until the invoice audit paid for the whole year. I tell prospects to run the same maths.",
      author: "Hannah Weiss",
      author_role: "Finance Lead",
      author_company: "Vantage Retail",
      source: "email",
      tags: ["pricing", "objection-handling"],
    },
    {
      quote:
        "Migration took one afternoon instead of the quarter we budgeted, and nothing broke in staging or production.",
      author: "Kwame Boateng",
      author_role: "Engineering Manager",
      author_company: "Hexa Cloud",
      source: "call",
      tags: ["migration", "integration"],
    },
    {
      quote:
        "The fastest time from contract to live workflow we have ever had — two weeks, including the security review.",
      author: "Sofia Marino",
      author_role: "Ops Director",
      author_company: "Atlas Freight",
      source: "form",
      tags: ["speed", "onboarding"],
    },
    {
      quote:
        "The dashboards look like something our own design team shipped, which is exactly why procurement approved it.",
      author: "Liam Doyle",
      author_role: "CTO",
      author_company: "Fenwick Group",
      source: "linkedin",
      tags: ["design", "trust"],
    },
  ],
  bob: [
    {
      quote:
        "Pricing was the biggest blocker in our funnel. Six weeks later our checkout stopped leaking customers.",
      author: "Elena Duarte",
      author_role: "Founder",
      author_company: "Cadence Studio",
      source: "email",
      tags: ["pricing", "checkout"],
    },
    {
      quote:
        "Churn dropped from 6.4% to 3.1% in two quarters, and the exit surveys finally make sense.",
      author: "Marcus Lin",
      author_role: "Retention Lead",
      author_company: "Pinecone CRM",
      source: "form",
      tags: ["retention", "churn"],
    },
    {
      quote:
        "Time-to-value went from eleven days to under two. New customers invite their team before we even follow up.",
      author: "Aisha Bello",
      author_role: "Customer Success",
      author_company: "Solstice HR",
      source: "call",
      tags: ["onboarding", "activation"],
    },
    {
      quote:
        "SOC 2 evidence, SSO and our weird legacy ERP — they handled all three without a single custom contract.",
      author: "Jonas Kruger",
      author_role: "CISO",
      author_company: "Meridian Bank",
      source: "email",
      tags: ["security", "integration"],
    },
    {
      quote:
        "We attributed 1.2 million of pipeline to the campaigns they rebuilt. No other vendor gave us that breakdown.",
      author: "Grace Abara",
      author_role: "CMO",
      author_company: "Tidal Metrics",
      source: "linkedin",
      tags: ["results", "roi"],
    },
    {
      quote:
        "99.98% uptime through our launch week, and an engineer on the call within minutes when we panicked.",
      author: "Viktor Novak",
      author_role: "Platform Lead",
      author_company: "Orbit Payments",
      source: "call",
      tags: ["support", "reliability"],
    },
    {
      quote:
        "Our reporting used to be a Friday spreadsheet ritual. Now the board pulls its own numbers.",
      author: "Chloe Bernard",
      author_role: "Analytics Manager",
      author_company: "Larkspur Media",
      source: "form",
      tags: ["reporting", "data"],
    },
    {
      quote:
        "We migrated 400k contacts over a weekend with zero duplicates. I still do not know how they QA'd it.",
      author: "Samir Haddad",
      author_role: "RevOps Director",
      author_company: "Copperline",
      source: "email",
      tags: ["migration", "speed"],
    },
  ],
};

/**
 * A deliberately messy export for the CSV tests (Day 4):
 *   - a semicolon delimiter, which European spreadsheets write by default
 *   - a quoted comma inside a name
 *   - a quote containing a newline, which is how feedback arrives from a form
 *   - `Row 4` repeating `Row 2` with different spacing and capitalisation, so a
 *     guard that only compares raw strings would let it through
 *   - `Row 6` with an empty quote, which must be reported, not guessed at
 */
export const CSV_UPLOAD = [
  'Quote;Author;Role;Company;Source;Tags',
  'The pricing wall came down once finance saw the ledger audit.;Dana Whitfield;Head of Ops;Northwind;email;pricing, roi',
  'The kickoff went from a two-hour call to a twenty-minute one.;Marcus Lee;Founder;Brightloop;g2;"onboarding, speed"',
  '"We stopped losing feedback in Slack threads.\nIt all lands in one place now, which is the whole point.";Priya Raman;RevOps Lead;Kestrel;slack;#pain-points',
  '   the pricing wall came down once finance saw the ledger audit.  ;Dana Whitfield;Head of Ops;Northwind;email;pricing',
  'The board opens the dashboard itself instead of waiting for a deck.;Chloe Bernard;Analytics Manager;Larkspur Media;form;reporting',
  ';Nobody said anything here;Anonymous;Nowhere;form;',
  'They answered within four minutes on a public holiday.;Viktor Novak;Platform Lead;Orbit Payments;call;support, reliability',
].join("\r\n");
