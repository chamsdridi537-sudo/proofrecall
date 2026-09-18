import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign the current user out and clear session cookies. */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // 303 = "see other": the browser follows the redirect with GET,
  // so a refresh can't re-submit the sign-out form.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
