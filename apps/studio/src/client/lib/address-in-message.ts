import { looksLikeHost, resolveUrlOrSearch } from "./resolve-url-or-search";

/** A web address a message is made of: where it goes, and how a row names it. */
export interface MessageAddress {
  /** The address as a person reads it: host and path, no scheme, no `www.`, no trailing slash. */
  shown: string;
  url: string;
}

/**
 * The web address a message is, when its whole text is one: a single word
 * that is an http(s) URL, or a host the address field would go to (a domain
 * with a known suffix, an IP, localhost, a host with a port), with or without
 * a path. Anything with other words in it is a message.
 */
export function addressInMessage(words: string): MessageAddress | undefined {
  const word = words.trim();
  if (word === "" || /\s/.test(word)) {
    return undefined;
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
  return { shown, url };
}
