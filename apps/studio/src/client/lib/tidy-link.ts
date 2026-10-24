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
