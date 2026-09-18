import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Email-confirmation landing route.
 *
 * The Supabase "Confirm signup" email template links here with
 * `?token_hash=...&type=signup`. We verify the token server-side and
 * set the session cookies on the response.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      // Cast is safe: Supabase only sends types it supports.
      type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
      token_hash,
    });

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=invalid_confirmation_link", request.url));
}
