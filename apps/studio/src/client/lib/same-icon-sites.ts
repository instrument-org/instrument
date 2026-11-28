import { siteOf } from "@/shared/site-of";
import { useSyncExternalStore } from "react";

import {
  faviconUrlNow,
  subscribeToFaviconUrls,
} from "@/client/lib/favicon-url";

/**
 * Sites drawn in one row of icons, with those whose icons are the same image
 * drawn once. Copies of one site under many names (the mirrors a search turns
 * up) would otherwise fill a row with one icon over and over.
 */
export interface SameIconSites {
  /** The site the icon is drawn for: the first of them in the row. */
  url: string;
  /** Every host the icon stands for, in the row's order. */
  hosts: string[];
}

/**
 * What each icon address is, by its bytes' digest, or by its site where it
 * could not be read (no icon, or a request that failed): such a site draws its
 * own stand-in, so it is one of a kind. Kept for the session, since an address
 * names its icon until the theme or the site's icon changes, which gives
 * another address.
 */
const identities = new Map<string, string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

/**
 * The sites in `urls` grouped by identical icon, in order of first appearance.
 * A site whose icon is still being read is left out until it is known, so a
 * row never draws a run of copies that then folds into one.
 */
export function useSameIconSites(urls: readonly string[]): SameIconSites[] {
  const known = useSyncExternalStore(subscribe, () =>
    urls.map((url) => identityOf(faviconUrlNow(url)) ?? "").join("\n"),
  );
  return groupSites(urls, known.split("\n"));
}

/**
 * The sites grouped by identity, each identity from the same position in
 * `identities`; an empty identity is one not known yet, and is left out.
 */
export function groupSites(
  urls: readonly string[],
  identityList: readonly string[],
): SameIconSites[] {
  const groups = new Map<string, SameIconSites>();
  for (const [index, url] of urls.entries()) {
    const identity = identityList[index];
    if (!identity) {
      continue;
    }
    const host = hostOf(url);
    const group = groups.get(identity);
    if (!group) {
      groups.set(identity, { hosts: [host], url });
    } else if (!group.hosts.includes(host)) {
      group.hosts.push(host);
    }
  }
  return [...groups.values()];
}

function identityOf(address: string): string | undefined {
  const known = identities.get(address);
  if (known === undefined && !inFlight.has(address)) {
    inFlight.add(address);
    void readIdentity(address).then((identity) => {
      inFlight.delete(address);
      identities.set(address, identity);
      for (const listener of listeners) {
        listener();
      }
    });
  }
  return known;
}

/**
 * Reads the icon the `<img>` beside it draws. The main process answers both
 * from its copy on disk, so the second read costs a file read, not a request.
 */
async function readIdentity(address: string): Promise<string> {
  const ownSite = `site:${siteOf(hostOf(new URL(address).pathname.slice(1)))}`;
  try {
    const response = await fetch(address);
    if (!response.ok) {
      return ownSite;
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await response.arrayBuffer(),
    );
    return `icon:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return ownSite;
  }
}

function hostOf(url: string) {
  return URL.canParse(url) ? new URL(url).hostname : decodeURIComponent(url);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = subscribeToFaviconUrls(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}
