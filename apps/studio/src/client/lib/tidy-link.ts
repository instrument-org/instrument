/** How much of a path, query and fragment a bare link shows after its host. */
const MAX_SHOWN_TAIL_LENGTH = 30;

/** A bare link's label, drawn short. */
export interface TidyLink {
  /** The host and the start of the rest. */
  shown: string;
  /** Whether more of the address follows than a trailing slash, which an ellipsis says. */
  cut: boolean;
}

/**
 * A link written as its own address, as a shorter label: no scheme, no
 * `www.`, the host whole, and the rest cut at a reading length. Undefined when
 * the label is words someone chose rather than the address, or when the
 * address is not a web page.
 *
 * Escapes that stand for letters, digits and the few marks a path spells with
 * are shown as those characters, so a page named in another language reads in
 * it. Any other escape stays as written: a space or a control character
 * decoded into a label is one that can disguise where the rest of it goes.
 */
export function tidyLink(href: string, label: string): TidyLink | undefined {
  if (label !== href && `http://${label}` !== href) {
    return undefined;
  }
  const match = /^(https?:\/\/)?(www\.)?([^/?#]+)(.*)$/iu.exec(label);
  if (!match || !isPlainWebAddress(href)) {
    return undefined;
  }
  const [, , , host = "", tail = ""] = match;
  const readable = decodeReadable(tail);
  // A trailing slash says nothing a reader needs.
  const trimmed = readable.replace(/\/$/u, "");
  const shownTail =
    trimmed.length > MAX_SHOWN_TAIL_LENGTH
      ? trimmed.slice(0, MAX_SHOWN_TAIL_LENGTH)
      : trimmed;
  return {
    cut: shownTail.length < trimmed.length,
    shown: `${host}${shownTail}`,
  };
}

/**
 * A web page's address with no user or password in it. One with them is left
 * as written: `https://github.com@evil.test` shortened reads as GitHub.
 */
function isPlainWebAddress(href: string) {
  const url = URL.parse(href);
  return (
    (url?.protocol === "http:" || url?.protocol === "https:") &&
    url.username === "" &&
    url.password === ""
  );
}

const READABLE = /^[\p{L}\p{N}\p{M}()!*'~_.-]+$/u;

function decodeReadable(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/giu, (run) => {
    try {
      const decoded = decodeURIComponent(run);
      return READABLE.test(decoded) ? decoded : run;
    } catch {
      return run;
    }
  });
}

/** How long a page's title runs as a link's label before it is cut. */
const MAX_TITLE_LENGTH = 80;

// What a page puts between its own name and the site's: "Chili | Serious
// Eats", "Amazon.com: Voss Water", "Fix · GitHub", "Install :: Support".
const TITLE_SEPARATOR = /(\s(?:[|·•–—-]|::)\s|:\s)/u;

/**
 * A page's title as a link's label: without the site's name at either end,
 * which the site's icon in front already says, and cut at a reading length.
 * Undefined when the title is the site's name and nothing else, which a page
 * behind a sign-in answers with: a link to one page labeled "Notion" says
 * less than its address does.
 */
export function titleLabel(title: string, href: string): string | undefined {
  const names = siteNamesOf(href);
  const whole = title.trim();
  if (isSiteName(whole, names)) {
    return undefined;
  }
  const trimmed = withoutSiteName(whole, names);
  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }
  const cut = trimmed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Whether a piece of a title is the site's name: a few words spelling one of
 * the words in its host, the way "Wikimedia Commons" spells commons.wikimedia.org.
 */
function isSiteName(segment: string, names: string[]): boolean {
  const folded = segment.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return (
    segment.split(/\s+/u).length <= 3 &&
    names.some((name) => folded.includes(name))
  );
}

function withoutSiteName(title: string, names: string[]): string {
  // Segments at the even places, the separators between them at the odd.
  const parts = title.split(TITLE_SEPARATOR);
  if (parts.length < 3) {
    return title;
  }
  if (isSiteName(parts.at(-1) ?? "", names)) {
    return parts.slice(0, -2).join("").trim();
  }
  if (isSiteName(parts[0] ?? "", names)) {
    return parts.slice(2).join("").trim();
  }
  return title;
}

/** The words a site's name is spelled from in its host: `seriouseats` for www.seriouseats.com. */
function siteNamesOf(href: string): string[] {
  const host = URL.parse(href)?.hostname ?? "";
  return host
    .split(".")
    .slice(0, -1)
    .filter((label) => label.length >= 3 && label !== "www");
}
