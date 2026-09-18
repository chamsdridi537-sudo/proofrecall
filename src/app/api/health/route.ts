import { NextResponse } from "next/server";

// Always hit the function (never a cached/prerendered response) so this is a
// real liveness probe.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "proofrecall",
    timestamp: new Date().toISOString(),
    day: 5,
    note: "objection-first entry + copy-with-attribution live",
  });
}
