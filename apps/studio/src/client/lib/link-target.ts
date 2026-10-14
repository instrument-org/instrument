// How much of a path, query, and fragment is worth printing before the rest of
// it stands for itself. A tracking URL runs to thousands of characters, and a
// destination nobody can take in at a glance is one nobody reads at all; what
// fits here is a few lines, which is also as much as a tooltip can cover
// without hiding the sentence it was hovered from.
const MAX_TAIL_LENGTH = 180;

/** A destination in the four pieces it is read in. */
export interface DestinationParts {
  /** Host and port: the part that decides where a click lands. */
  authority: string;
  /**
   * The user and password an href can carry, ending in the `@` that separates
   * them from the host. Empty for almost every URL there is.
   *
   * Held apart from the authority because they are chosen by whoever wrote the
   * href and decide nothing about where it goes, which is the whole of what
   * makes `https://github.com@evil.test/x` work: read as one run, it opens on
   * a name the reader trusts. So they are drawn with the scheme and the path
   * rather than with the host, and the host is left as the one thing said at
   * full strength.
   */
  credentials: string;
  /** The scheme and its slashes. */
  scheme: string;
  /** Path, query, and fragment, cut short once it runs past reading length. */
  tail: string;
}

/**
 * The whole destination, split so the part deciding where a click lands can be
 * drawn apart from the parts that do not.
 *
 * Read off the parsed URL rather than the href as it was written, so what is
 * shown is the destination the way it resolved: a host in punycode and a path
 * percent-encoded, ASCII throughout, which is what keeps the lookalike glyphs
 * and bidi controls a label can carry out of the one place they would be
 * believed.
 */
export function destinationParts(url: URL): DestinationParts {
  const scheme = `${url.protocol}//`;
  const credentials = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ""}@`
    : "";
  const authority = url.host;
  const tail = url.href.slice(
    scheme.length + credentials.length + authority.length,
  );

  return {
    authority,
    credentials,
    scheme,
    tail:
      tail.length > MAX_TAIL_LENGTH
        ? `${tail.slice(0, MAX_TAIL_LENGTH)}…`
        : tail,
  };
}

/**
 * The address a `mailto:` link is for, or null when the href is not one.
 *
 * Subject and body are dropped. They belong to the message the link opens, not
 * to the question of who it is addressed to, and the href itself still carries
 * them unchanged.
 */
export function mailtoAddress(href: string): null | string {
  if (!/^mailto:/iu.test(href)) {
    return null;
  }
  const raw = href.slice("mailto:".length).split("?")[0] ?? "";
  let address = raw;
  try {
    address = decodeURIComponent(raw);
  } catch {
    // Keep the raw text when it isn't valid percent-encoding.
  }
  return address.includes("@") ? address : null;
}

/**
 * The URL behind an href that goes to the web, or undefined for anything else.
 *
 * A destination is shown for a page a link leaves for, so the schemes that
 * reach a page are the only ones it applies to. Everything else -- `mailto:`,
 * `data:`, a scheme nothing here recognizes -- is somebody else's case.
 */
export function webUrl(href: string): undefined | URL {
  if (!URL.canParse(href)) {
    return undefined;
  }
  const url = new URL(href);
  return url.protocol === "http:" || url.protocol === "https:"
    ? url
    : undefined;
}
