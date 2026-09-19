"use client";

import { useEffect, type ReactNode } from "react";
import { loadAnalytics } from "@/lib/analytics";

/**
 * Mounts the PostHog snippet once per page (see `src/lib/analytics.ts` for why
 * it is a snippet and not a dependency). Mounted in the root layout so the
 * landing page, /login and /dashboard all share one browser identity — that is
 * what lets `signed_up` and the first `searched` be the same person rather than
 * two anonymous half-stories.
 */
export default function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    loadAnalytics();
  }, []);

  return <>{children}</>;
}
