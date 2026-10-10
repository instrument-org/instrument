/**
 * What the app knows about a navigation before the guest makes it, which
 * Electron's events cannot say: that the person typed the address or picked
 * a bookmark, that the app is reopening a page to restore a tab, and that a
 * tab is on the app's own sign-in flow. Each is told here by the code that
 * starts the navigation and read by the history recorder when it commits.
 *
 * A typed mark is keyed by address, since the renderer often starts the
 * load before it knows which tab will make it; a restored one by the tab and
 * the address. Both expire, so a mark never used cannot claim a later visit.
 */

/** How long a typed or restored mark waits for its navigation. */
const MARK_TTL_MS = 30_000;
/** How long a sign-in counts as pending when nothing settles it: the longest a person plausibly spends signing in. */
const SIGN_IN_TTL_MS = 15 * 60_000;

const typed = new Map<string, number>();
const restored = new Map<string, number>();
const signIns = new Map<string, { until: number; url: string }>();

/** An address as Chromium writes it, so a mark matches the URL the guest reports. */
function normalized(url: string): string {
  return URL.parse(url)?.href ?? url;
}

function take(marks: Map<string, number>, keys: readonly string[]): boolean {
  const now = Date.now();
  for (const [url, until] of marks) {
    if (until < now) {
      marks.delete(url);
    }
  }
  const hit = keys.find((key) => marks.has(key));
  if (hit === undefined) {
    return false;
  }
  marks.delete(hit);
  return true;
}

export function noteTyped(url: string) {
  typed.set(normalized(url), Date.now() + MARK_TTL_MS);
}

/** The tab's guest is about to be taken back to the page it was on; the key is the tab's target id. */
export function noteRestored(tab: string, url: string) {
  restored.set(`${tab} ${normalized(url)}`, Date.now() + MARK_TTL_MS);
}

export function takeTyped(urls: readonly string[]): boolean {
  return take(typed, urls.map(normalized));
}

export function takeRestored(tab: string, urls: readonly string[]): boolean {
  return take(
    restored,
    urls.map((url) => `${tab} ${normalized(url)}`),
  );
}

/** An app sign-in started that opens its authorization page in the window's browser. */
export function expectSignIn(slug: string, authorizationUrl: string) {
  signIns.set(slug, {
    until: Date.now() + SIGN_IN_TTL_MS,
    url: normalized(authorizationUrl),
  });
}

/** An app sign-in finished, failed, was declined or was canceled. */
export function settleSignIn(slug: string) {
  signIns.delete(slug);
}

export function signInPending(slug: string): boolean {
  const pending = signIns.get(slug);
  if (pending === undefined) {
    return false;
  }
  if (pending.until < Date.now()) {
    signIns.delete(slug);
    return false;
  }
  return true;
}

/** The pending sign-in whose authorization page is at this address. */
export function signInAt(url: string): string | undefined {
  const address = normalized(url);
  for (const [slug, pending] of signIns) {
    if (pending.url === address && signInPending(slug)) {
      return slug;
    }
  }
  return undefined;
}
