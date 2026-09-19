/**
 * The first-run coach's flag, as a real external store (Day 7).
 *
 * The React Compiler rule `react-hooks/set-state-in-effect` exists precisely
 * for the shape this code started in — an effect that reads localStorage on
 * mount and calls `setState`. That is not "mounting work"; it is a second
 * source of truth being copied into React. The rule-conformant expression is
 * `useSyncExternalStore`: the store *is* localStorage, React subscribes to it,
 * and `markCoachSeen` is the only writer.
 *
 * `getServerSnapshot` answers "seen": the server cannot know this device's
 * history, so the HTML never renders the coach, hydration never disagrees
 * with itself, and a genuine first-look device gets the pulse one frame later
 * from the client snapshot. `scripts/qa/day7.mjs` asserts exactly that
 * absence, and the one-frame version is what the browser check observes.
 *
 * The `storage` event covers other tabs; the listener set covers this one,
 * which — per spec — never receives its own storage event.
 */

const KEY = "proofrecall.coach.v1";

const listeners = new Set<() => void>();

export function readCoachSnapshot(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Private-mode throws on access; a visitor who cannot be remembered has
    // already opted out of the coach, not out of the product.
    return "seen";
  }
}

export function readCoachServerSnapshot(): string {
  return "seen";
}

export function subscribeCoach(onChange: () => void): () => void {
  const onStorage = () => onChange();
  window.addEventListener("storage", onStorage);
  listeners.add(onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners.delete(onChange);
  };
}

export function markCoachSeen(): void {
  try {
    window.localStorage.setItem(KEY, "seen");
  } catch {
    /* same as above — worst case, they see the pulse again tomorrow */
  }
  for (const onChange of [...listeners]) onChange();
}
