/**
 * PostHog plumbing (Day 7) — exactly three custom events:
 *
 *   `signed_up`     when account creation succeeds (props: confirmation_required)
 *   `searched`      when a search answers (props: hits, tier, chip)
 *   `copied_quote`  when a quote lands on the clipboard (props: quote_id)
 *
 * Deliberately NOT the npm package. This repo has no committed lockfile (a local
 * `npm install` is blocked on the laptop), so every build — CI and Vercel —
 * resolves dependencies fresh from `package.json`. Adding a dependency nobody can
 * execute locally means adopting a version that first runs in production. The
 * `/static/array.js` endpoint, by contrast, is PostHog's stable public install
 * contract and needs no build-time dependency at all.
 *
 * Silence-by-design: with no `NEXT_PUBLIC_POSTHOG_KEY` set, nothing is fetched,
 * nothing is captured, and the app behaves exactly as it did before Day 7. A
 * deploy without analytics configured must be indistinguishable from a deploy
 * that decided not to have analytics.
 *
 * Init turns `autocapture` and `capture_pageview` off. The agreement was three
 * events, not "everything the browser can see"; pageviews are one flag away if
 * that decision ever changes.
 */

type PostHog = {
  init: (key: string, options?: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
};

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

/** True when this build was given a key at all — used by the health route's twin. */
export const analyticsEnabled = KEY.length > 0;

function lib(): PostHog | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { posthog?: PostHog }).posthog;
}

let loading = false;
let ready = false;
let pendingIdentify: { id: string; props?: Record<string, unknown> } | null = null;
const queued: Array<{ event: string; props?: Record<string, unknown> }> = [];

/**
 * Inject the snippet and init once per page.
 *
 * A failed script load resolves into silence, never into a thrown error: losing
 * analytics is a logging outage, and it must not take a sales tool's search box
 * down with it.
 */
export function loadAnalytics(): void {
  if (typeof window === "undefined" || !KEY || loading) return;
  loading = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `${HOST}/static/array.js`;
  script.onload = () => {
    const ph = lib();
    if (ph && !ready) {
      ph.init(KEY, { api_host: HOST, autocapture: false, capture_pageview: false });
      ready = true;
      if (pendingIdentify) {
        ph.identify(pendingIdentify.id, pendingIdentify.props);
        pendingIdentify = null;
      }
      // Interactions beat the script back at the keyboard; they wait here in
      // order rather than being dropped.
      for (const event of queued.splice(0)) {
        ph.capture(event.event, event.props);
      }
    }
  };
  script.onerror = () => {
    loading = false; // stay silent; the queue is abandoned on purpose
  };
  document.head.appendChild(script);
}

/** Tie this browser to the signed-in email so the three events land on one person. */
export function identifyUser(email: string, properties?: Record<string, unknown>): void {
  if (!KEY) return;
  const ph = lib();
  if (ready && ph) {
    ph.identify(email, properties);
    return;
  }
  pendingIdentify = { id: email, props: properties };
}

/**
 * Capture one of the three events. The `event` parameter is typed as a union
 * on purpose: the plan was three events, and the type is where a fourth would
 * otherwise quietly creep in.
 */
export function capture(
  event: "signed_up" | "searched" | "copied_quote",
  properties?: Record<string, unknown>,
): void {
  if (!KEY) return;
  const ph = lib();
  if (ready && ph) {
    ph.capture(event, properties);
    return;
  }
  queued.push({ event, props: properties });
}
