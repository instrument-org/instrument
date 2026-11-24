import { targetOfAddress } from "@/client/bookmarks/address";
import { isInstrumentAddress } from "@instrument-org/shared";

import { looksLikeHost, resolveUrlOrSearch } from "./resolve-url-or-search";

/**
 * An address typed words are: a page, with how a row names it, or one of the
 * app's own (`instrument://chat/<id>`), which a row names from what it opens.
 */
export type TypedAddress =
  | {
      /**
       * Why the words may be no address after all: a `host` with a dot in it
       * whose ending no site has (`node.js`, `foo.zzzzz`), or a `scheme` the
       * app's browser may not show (`ftp://`, `chrome://`). Absent for an
       * address a browser would go to without asking.
       */
      doubt?: "host" | "scheme";
      kind: "page";
      /** The address as a person reads it: host and path, no scheme, no `www.`, no trailing slash. */
      shown: string;
      url: string;
    }
  | { address: string; kind: "app" };

/**
 * The address typed words are, when the whole of them is one, read the same
 * way by every field that takes an address (the command menu, a tab's
 * address field, a new tab's box). One word that is:
 *
 * - an `instrument://` address, which is the app's own;
 * - an address with a scheme (`https://`, `file://`), as written; any scheme
 *   but `http`, `https` and `file` is in `doubt`;
 * - a host a browser would go to (a domain with a known ending, an IP,
 *   localhost, a host with a port), with or without a path, over `http` on
 *   this computer and `https` anywhere else;
 * - a name with a dot in it and an ending no site has, in `doubt`.
 *
 * `url` is the address as a browser loads it (`https://example.com/`).
 *
 * Each field decides what a doubted address is worth: it says what the words
 * are, never what Return does. Anything with a space in it, an email address
 * and a scheme without `//` (`mailto:`) is no address.
 */
export function typedAddress(words: string): TypedAddress | undefined {
  const word = words.trim();
  if (word === "" || /\s/.test(word)) {
    return undefined;
  }
  if (isInstrumentAddress(word)) {
    return targetOfAddress(word) ? { address: word, kind: "app" } : undefined;
  }
  let url: string | undefined;
  let doubt: "host" | "scheme" | undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word)) {
    url = word;
    doubt = /^(?:https?|file):\/\//i.test(word) ? undefined : "scheme";
  } else if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(word) && !word.includes("@")) {
    const authority = word.split(/[/?#]/, 1)[0] ?? word;
    if (looksLikeHost(authority)) {
      url = resolveUrlOrSearch(word);
    } else if (/^[\w-]+(?:\.[\w-]+)+$/.test(authority)) {
      url = `https://${word}`;
      doubt = "host";
    }
  }
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.protocol === "file:") {
    return {
      kind: "page",
      shown: `${decodeURIComponent(parsed.pathname)}${parsed.search}${parsed.hash}`,
      url: parsed.href,
    };
  }
  if (doubt === "scheme") {
    return { doubt, kind: "page", shown: word, url: parsed.href };
  }
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const shown =
    `${parsed.host.replace(/^www\./, "")}${path}${parsed.search}`.replace(
      /\/$/,
      "",
    );
  return { ...(doubt ? { doubt } : {}), kind: "page", shown, url: parsed.href };
}
