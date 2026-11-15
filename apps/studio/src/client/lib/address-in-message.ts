import { targetOfAddress } from "@/client/bookmarks/address";
import { isInstrumentAddress } from "@instrument-org/shared";

import { looksLikeHost, resolveUrlOrSearch } from "./resolve-url-or-search";

/**
 * An address a message is made of: a web page, with how a row names it, or
 * one of the app's own (`instrument://chat/<id>`), which the row names from
 * what it opens.
 */
export type MessageAddress =
  | {
      kind: "page";
      /** The address as a person reads it: host and path, no scheme, no `www.`, no trailing slash. */
      shown: string;
      url: string;
    }
  | { address: string; kind: "app" };

/**
 * The address a message is, when its whole text is one: a single word that
 * is an `instrument://` address this build opens, an http(s) URL, or a host
 * the address field would go to (a domain with a known suffix, an IP,
 * localhost, a host with a port), with or without a path. Anything with
 * other words in it is a message.
 */
export function addressInMessage(words: string): MessageAddress | undefined {
  const word = words.trim();
  if (word === "" || /\s/.test(word)) {
    return undefined;
  }
  if (isInstrumentAddress(word)) {
    return targetOfAddress(word) ? { address: word, kind: "app" } : undefined;
  }
  let url: string | undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word)) {
    url = /^https?:\/\//i.test(word) && URL.canParse(word) ? word : undefined;
  } else if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(word) && !word.includes("@")) {
    // Another scheme (mailto:, about:) or an email address is not a page.
    const authority = word.split(/[/?#]/, 1)[0] ?? word;
    url = looksLikeHost(authority) ? resolveUrlOrSearch(word) : undefined;
  }
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const shown =
    `${parsed.host.replace(/^www\./, "")}${path}${parsed.search}`.replace(
      /\/$/,
      "",
    );
  return { kind: "page", shown, url };
}
