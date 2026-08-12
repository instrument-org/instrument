import { normalizeTaskFilePath } from "@instrument-org/workspace/client";

// A schemeless, non-anchor href is a candidate task-file reference (e.g. the
// agent's `[Download](output/report.xml)`). Real URLs carry a scheme
// (`https:`, `mailto:`, `data:`) or are protocol-relative (`//host`); those go
// to ExternalLink instead.
export const isTaskFileHref = (href: string): boolean =>
  !href.startsWith("#") &&
  !href.startsWith("//") &&
  !/^[a-z][a-z0-9+.-]*:/i.test(href);

/**
 * The task file path a markdown link's target names.
 *
 * One rule, because two callers act on the answer: the chip a link renders as,
 * and the check for whether a file grid would draw a second copy of that same
 * file. Two decoders would put a file in both places, and a filename holding a
 * bare `%` (`output/100%.png` is a valid one) would throw rather than render.
 */
export const taskFilePathFromHref = (href: string): string => {
  let path = href;
  try {
    path = decodeURIComponent(href);
  } catch {
    // Keep the raw href when it isn't valid percent-encoding.
  }
  return normalizeTaskFilePath(path);
};
