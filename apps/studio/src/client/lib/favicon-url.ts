import { APP_PROTOCOL } from "@instrument-org/shared";
import { useSyncExternalStore } from "react";

/**
 * A favicon for any URL, as the app keeps it: the main process answers from a
 * copy on disk, fetched once per site from a favicon proxy that has already
 * fetched it (see `electron-main/lib/site-icons.ts`).
 *
 * Only the host is asked for, never the URL as written. An icon belongs to a
 * site rather than to a page, so the path and query buy nothing and are the
 * half worth keeping: a link a model quoted or a person pasted carries document
 * ids, ticket numbers, search terms, and signed parameters, and none of those
 * should travel to draw a twelve-pixel image. Asking per host also collapses
 * every link to one site onto a single kept copy.
 *
 * A source that is not a parseable URL is passed through as it was written, so
 * the caller's own handling of a malformed href is what decides.
 */
export function getFaviconUrl(url: string, retry = 0): string {
  const src = `${APP_PROTOCOL}://site-icon/${encodeURIComponent(hostOf(url))}?theme=${themeNow()}`;
  // The main process reads the host and theme alone, so the count only changes
  // the address the page sees, not what it is answered with.
  return retry > 0 ? `${src}&retry=${retry}` : src;
}

/**
 * The address to draw a site's icon from, redrawing its reader when the theme
 * changes or the site is given another icon.
 */
export function useFaviconUrl(url: string): string {
  return useSyncExternalStore(subscribeToAddress, () =>
    getFaviconUrl(url, retries.get(hostOf(url)) ?? 0),
  );
}

/**
 * Hosts whose icon did not load this session, so a row drawn again draws its
 * stand-in at once rather than holding an empty slot until the answer repeats.
 * Kept in memory only: the main process holds what is known about a site, and
 * a failure here may have been the network rather than the site.
 *
 * Observable, because the answer changes under rows already on screen: a chat
 * names a site before anything is kept for it, its first lookup fails, and a
 * moment later the page opened in a browser tab hands over its own icon. A row
 * that read the set once would go on hiding that icon until the app reloads.
 * Replaced rather than mutated, so a snapshot's identity says it changed.
 */
let iconlessThisSession: ReadonlySet<string> = new Set<string>();

/** How many times each host has been given another icon, so the address asked for next is one the page has not already drawn or seen fail. */
const retries = new Map<string, number>();

const listeners = new Set<() => void>();

/** A site given another icon, or one after failing, so every row drawing it asks again. */
export function siteIconChanged(url: string) {
  const host = hostOf(url);
  retries.set(host, (retries.get(host) ?? 0) + 1);
  iconlessThisSession = new Set(
    [...iconlessThisSession].filter((entry) => entry !== host),
  );
  notify();
}

/** The host a site's icon is kept under, for checking a site against `useIconlessHosts`. */
export function iconHostOf(url: string) {
  return hostOf(url);
}

export function markIconlessThisSession(url: string) {
  const host = hostOf(url);
  if (iconlessThisSession.has(host)) {
    return;
  }
  iconlessThisSession = new Set([...iconlessThisSession, host]);
  notify();
}

/** Every host found iconless this session, redrawing its reader as the set changes. */
export function useIconlessHosts(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => iconlessThisSession);
}

/** Whether the site was found iconless this session, redrawing its reader when that changes. */
export function useIsIconlessThisSession(url: string): boolean {
  return useSyncExternalStore(subscribe, () =>
    iconlessThisSession.has(hostOf(url)),
  );
}

function hostOf(url: string) {
  return URL.canParse(url) ? new URL(url).hostname : url;
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The theme on screen, as the class the app sets on the page's root. */
function themeNow() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | undefined;

function subscribeToAddress(listener: () => void) {
  const unsubscribe = subscribe(listener);
  themeListeners.add(listener);
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      for (const changed of themeListeners) {
        changed();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
    });
  }
  return () => {
    unsubscribe();
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      themeObserver?.disconnect();
      themeObserver = undefined;
    }
  };
}
