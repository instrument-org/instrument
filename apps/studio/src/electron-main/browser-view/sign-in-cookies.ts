import { type SignInCookieSite } from "@instrument-org/workspace/electron";
import { type Cookie } from "electron";
import { createHmac, randomBytes } from "node:crypto";

import { browserSession, registrableDomainOf } from "./browsing-data";
import { log } from "./log";

/**
 * Which other sites a web app's sign-in in the window's browser left
 * cookies on, such as x.com after signing in to grok.com with X. The
 * browser's cookies are read when the sign-in's page opens and again when
 * it connects, and the two are compared; nothing listens to the cookie
 * store in between. Only sites whose pages the sign-in's tab, or a popup
 * it opened, loaded in its main frame count, each hop of a server redirect
 * included, so an ad or analytics site that set cookies from inside
 * another page is left out, and so are the app's own sites: those its
 * setup and the directory name, and those the load Studio started in a tab
 * opened for the sign-in was redirected to before its first page (grok.com
 * sends its sign-in to accounts.x.ai). Where a page's own navigation goes,
 * redirects and all, is never the app's.
 *
 * A snapshot lives in memory for its sign-in alone and holds a hash of each
 * value, keyed for that sign-in, never a value; what leaves is each site and
 * how many of its cookies were set or changed.
 */

/**
 * A browser's cookies at a moment: by the domain each is set for, then by
 * its path and name, a keyed hash of its value.
 */
export type CookieSnapshot = ReadonlyMap<string, ReadonlyMap<string, string>>;

type SnapshotCookie = Pick<Cookie, "domain" | "name" | "path" | "value">;

/** How long a started sign-in keeps its snapshot, waiting for Done. */
const SIGN_IN_TTL_MS = 60 * 60_000;

export function cookieSnapshot(
  cookies: readonly SnapshotCookie[],
  hash: (value: string) => string,
): CookieSnapshot {
  const snapshot = new Map<string, Map<string, string>>();
  for (const { domain = "", name, path = "", value } of cookies) {
    const ofDomain = snapshot.get(domain) ?? new Map<string, string>();
    ofDomain.set(`${path}\n${name}`, hash(value));
    snapshot.set(domain, ofDomain);
  }
  return snapshot;
}

/** The site an http(s) address is on, or none for any other address. */
function siteOfAddress(address: string): string[] {
  const url = URL.parse(address);
  return url?.protocol === "https:" || url?.protocol === "http:"
    ? [registrableDomainOf(url.hostname)]
    : [];
}

/**
 * The sites with cookies set or changed from `before` to `after`, each with
 * how many, most first: only sites one of `pages` is on, and none of the
 * app's own.
 */
export function signInCookieSites({
  after,
  appAddresses,
  before,
  firstLoad,
  pages,
}: {
  after: CookieSnapshot;
  /** The app's own addresses: its site and sign-in page, its setup's and the directory's. */
  appAddresses: readonly string[];
  before: CookieSnapshot;
  /**
   * The addresses the load Studio started in a tab opened for the sign-in
   * went through before its first page, which are the app's own too.
   */
  firstLoad: Iterable<string>;
  /** The addresses the sign-in's tabs loaded in their main frame. */
  pages: Iterable<string>;
}): SignInCookieSite[] {
  const own = new Set(
    [...appAddresses, ...firstLoad].flatMap(siteOfAddress),
  );
  const loaded = new Set(
    [...pages].flatMap(siteOfAddress).filter((site) => !own.has(site)),
  );
  const counts = new Map<string, number>();
  for (const [domain, cookies] of after) {
    const site = registrableDomainOf(domain);
    if (!loaded.has(site)) {
      continue;
    }
    const was = before.get(domain);
    for (const [cookie, hash] of cookies) {
      if (was?.get(cookie) !== hash) {
        counts.set(site, (counts.get(site) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([site, cookies]) => ({ cookies, site }))
    .toSorted((a, b) => b.cookies - a.cookies || a.site.localeCompare(b.site));
}

interface SignIn {
  /** The cookies as the sign-in's page opened, or undefined when they could not be read. */
  before: Promise<CookieSnapshot | undefined>;
  /**
   * The tab whose page Studio is loading for the sign-in, until that load
   * commits its first page.
   */
  firstLoad: string | undefined;
  /** The origins that load went through. */
  firstLoadPages: Set<string>;
  hash: (value: string) => string;
  /** The origins of the pages its tabs loaded. */
  pages: Set<string>;
  /** The sign-in's tab and the popups opened from it, by target id. */
  tabs: Set<string>;
  until: number;
}

/** The web sign-ins under way, by the app's slug. */
const signIns = new Map<string, SignIn>();

async function readSnapshot(
  hash: (value: string) => string,
): Promise<CookieSnapshot | undefined> {
  try {
    return cookieSnapshot(await browserSession().cookies.get({}), hash);
  } catch (error) {
    log.warn(
      new Error("Could not read the browser's cookies", { cause: error }),
    );
    return undefined;
  }
}

/** The sign-ins still under way, dropping any that waited too long. */
function underWay(): SignIn[] {
  const now = Date.now();
  for (const [slug, signIn] of signIns) {
    if (signIn.until < now) {
      signIns.delete(slug);
    }
  }
  return [...signIns.values()];
}

/**
 * A web app's sign-in opened its page in `tab`: the browser's cookies are
 * read now, for `finishSignInCookies` to compare with. `loadsSignIn` when
 * Studio is loading the sign-in page there, so where that load is
 * redirected before its first page is the app's own. A sign-in started
 * again starts over.
 */
export function startSignInCookies(
  slug: string,
  tab: string,
  { loadsSignIn }: { loadsSignIn: boolean },
): void {
  const key = randomBytes(32);
  const hash = (value: string) =>
    createHmac("sha256", key).update(value).digest("base64");
  signIns.set(slug, {
    before: readSnapshot(hash),
    firstLoad: loadsSignIn ? tab : undefined,
    firstLoadPages: new Set(),
    hash,
    pages: new Set(),
    tabs: new Set([tab]),
    until: Date.now() + SIGN_IN_TTL_MS,
  });
}

/** A tab's main frame started for or was redirected to `url`. */
export function noteSignInPage(tab: string, url: string): void {
  if (signIns.size === 0) {
    return;
  }
  const page = URL.parse(url);
  if (page?.protocol !== "https:" && page?.protocol !== "http:") {
    return;
  }
  for (const signIn of underWay()) {
    if (signIn.tabs.has(tab)) {
      signIn.pages.add(page.origin);
    }
    if (signIn.firstLoad === tab) {
      signIn.firstLoadPages.add(page.origin);
    }
  }
}

/**
 * A tab's main frame committed a page at `url`: a sign-in's first load
 * there is over, and where the tab goes from here is its page's doing.
 */
export function noteSignInCommit(tab: string, url: string): void {
  if (signIns.size === 0) {
    return;
  }
  const page = URL.parse(url);
  // The blank page a tab is born on is not the load's first page.
  if (page?.protocol !== "https:" && page?.protocol !== "http:") {
    return;
  }
  for (const signIn of underWay()) {
    if (signIn.firstLoad === tab) {
      signIn.firstLoad = undefined;
    }
  }
}

/** A page in `opener` opened a popup at `url`, which counts as the sign-in's when its opener does. */
export function noteSignInPopup(
  opener: string,
  popup: string,
  url: string,
): void {
  for (const signIn of underWay()) {
    if (signIn.tabs.has(opener)) {
      signIn.tabs.add(popup);
    }
  }
  noteSignInPage(popup, url);
}

/**
 * The app's sign-in connected: the other sites it left cookies on, compared
 * with the cookies as it started, and the snapshot let go. Empty for a
 * sign-in not started here, one that waited too long, or cookies that could
 * not be read.
 */
export async function finishSignInCookies(
  slug: string,
  appAddresses: readonly string[],
): Promise<SignInCookieSite[]> {
  const signIn = signIns.get(slug);
  signIns.delete(slug);
  if (signIn === undefined || signIn.until < Date.now()) {
    return [];
  }
  const [before, after] = await Promise.all([
    signIn.before,
    readSnapshot(signIn.hash),
  ]);
  if (before === undefined || after === undefined) {
    return [];
  }
  return signInCookieSites({
    after,
    appAddresses,
    before,
    firstLoad: signIn.firstLoadPages,
    pages: signIn.pages,
  });
}

/** The app's sign-in ended without connecting; its snapshot goes. */
export function dropSignInCookies(slug: string): void {
  signIns.delete(slug);
}
