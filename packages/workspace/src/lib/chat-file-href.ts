import {
  isWindowsPathHref,
  normalizeChatFilePath,
} from "./normalize-chat-file-path";

// A schemeless, non-anchor href is a candidate chat-file reference (e.g. the
// agent's `[Download](work/report.xml)`). Real URLs carry a scheme
// (`https:`, `mailto:`, `data:`) or are protocol-relative (`//host`); those go
// to ExternalLink instead. A Windows drive path (`C:/Users/sam/a.txt`) is a
// file whatever its `C:` looks like, and so is a path on a network share
// (`\\server\share\a.txt`).
export const isChatFileHref = (href: string): boolean =>
  isWindowsPathHref(href) ||
  (!href.startsWith("#") &&
    !href.startsWith("//") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(href));

/**
 * A place in a file a link's target may end with: a PDF's page, as a browser
 * reads `#page=4`, or a line, as a code host writes `#L12` or `#L12-L20`.
 * Only these, and only at the end, since `#` is a legal character in a file's
 * name.
 */
const PLACE_IN_FILE = /#(?:page=\d+|L\d+(?:-L?\d+)?)$/u;

/** The page a link to a file names, from a trailing `#page=N`. */
export const chatFilePageFromHref = (href: string): number | undefined => {
  const page = /#page=(\d+)$/u.exec(href)?.[1];
  return page === undefined || Number(page) < 1 ? undefined : Number(page);
};

/**
 * The chat file path a markdown link's target names, without the place in
 * the file a trailing fragment names.
 *
 * One rule, because two callers act on the answer: the chip a link renders as,
 * and the check for whether a file grid would draw a second copy of that same
 * file. Two decoders would put a file in both places, and a filename holding a
 * bare `%` (`work/100%.png` is a valid one) would throw rather than render.
 */
export const chatFilePathFromHref = (href: string): string => {
  const bare = href.replace(PLACE_IN_FILE, "");
  let path = bare;
  try {
    path = decodeURIComponent(bare);
  } catch {
    // Keep the raw href when it isn't valid percent-encoding.
  }
  return normalizeChatFilePath(path);
};
