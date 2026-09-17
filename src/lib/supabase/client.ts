import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * Day 1: wired but intentionally unused (no DB calls yet). Auth lands Day 2.
 * Reads NEXT_PUBLIC_* env vars, which are safe to expose to the browser.
 * The anon key is NOT a secret — access is gated by Row Level Security (RLS),
 * which we enable from Day 2 onward.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
