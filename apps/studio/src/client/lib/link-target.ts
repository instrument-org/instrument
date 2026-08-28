// Bidi controls reorder what a label draws without changing what it compares
// as, so a label carrying one can read as its destination's host while being
// something else. Stripping them here and rendering the label inside a `bdi`
// are the two halves of the same problem.
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

// A label that is an address: an optional scheme, a host, an optional port, and
// whatever path follows. Deliberately narrow, because an address this cannot
// read is one the reader cannot check against a host either, and the safe
// answer for those is to disclose. A path is allowed at the end and then
// ignored: a label naming the host and then a path still names the host.
const LABEL_ADDRESS =
  /^(?:(https?):\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,}|localhost)(?::(\d{1,5}))?(?:\/\S*)?$/iu;

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

/** The origin a label claims for itself, when it claims one at all. */
interface ClaimedOrigin {
  host: string;
  /** Empty when the label named no port, which then matches any port. */
  port: string;
  /** Empty when the label named no scheme, which then matches any scheme. */
  scheme: string;
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
 * The destination a link should name beside its label, or null when the label
 * already names it.
 *
 * A Markdown label is written by whoever wrote the message: a model quoting a
 * page it fetched, or text the person pasted into the composer. Nothing else on
 * screen says where the link lands, since the app has no status bar to hover
 * over, so a label that does not already name its destination gets the
 * destination put beside it.
 *
 * Host and port only, never the path. The path is long enough to wrap and is
 * not the part that decides whether a link is what it claims to be, and keeping
 * the cue to an origin is what lets a label naming that origin suppress it. The
 * scheme comes along only when the label made a claim about one, so the answer
 * arrives in the same terms as the question.
 */
export function originToDisclose(label: string, url: URL): null | string {
  const claimed = claimedOrigin(label.replaceAll(BIDI_CONTROLS, "").trim());
  const disclosure = claimed?.scheme
    ? `${url.protocol}//${url.host}`
    : url.host;

  // Credentials are never part of the disclosure, so a label that matched the
  // host of a URL carrying them would suppress the one part worth seeing.
  if (url.username || url.password) {
    return disclosure;
  }
  if (!claimed || claimed.host.toLowerCase() !== url.hostname.toLowerCase()) {
    return disclosure;
  }
  if (claimed.scheme && `${claimed.scheme.toLowerCase()}:` !== url.protocol) {
    return disclosure;
  }
  if (
    claimed.port &&
    claimed.port !== (url.port || DEFAULT_PORT[url.protocol])
  ) {
    return disclosure;
  }
  return null;
}

/**
 * The URL behind an href that goes to the web, or undefined for anything else.
 *
 * The disclosure is about a page a link leaves for, so the schemes that reach a
 * page are the only ones it applies to. Everything else -- `mailto:`, `data:`,
 * a scheme nothing here recognizes -- is somebody else's case.
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

/**
 * The origin a label claims for itself, when it claims one at all.
 *
 * A label naming a host and then a path still names that host, which is what
 * keeps a redundant origin off `example.com/a/b`. A label that is prose claims
 * nothing and comes back undefined, and so does one carrying credentials, since
 * the shape this reads has no room for them.
 */
function claimedOrigin(label: string): ClaimedOrigin | undefined {
  const address = LABEL_ADDRESS.exec(label);
  return address
    ? {
        host: address[2] ?? "",
        port: address[3] ?? "",
        scheme: address[1] ?? "",
      }
    : undefined;
}
