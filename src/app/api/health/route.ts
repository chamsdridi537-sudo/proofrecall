import { NextResponse } from "next/server";

// Always hit the function (never a cached/prerendered response) so this is a
// real liveness probe.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "proofrecall",
    timestamp: new Date().toISOString(),
    day: 7,
    note: "first-run coach (pulse + numbered empty state); 3 analytics events wired",
    // Which build this is, for the QA scripts: a deploy without the key is a
    // deploy that is silent, and `day7.mjs` asserts the silence is real.
    posthog_configured: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
  });
}
