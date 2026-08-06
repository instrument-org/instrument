import { normalizeTaskFilePath } from "@instrument-org/workspace/client";

// Bullets and numbers an agent adds when it reads the block as a list.
const LIST_MARKER = /^(?:[*+-]|\d+[.)])\s+/;
// A whole-line Markdown link, whose target is the path meant.
const MARKDOWN_LINK = /^\[[^\]]*\]\(([^)]+)\)$/;
// Wrapping pairs a path picks up from Markdown habits. Stripped only when both
// ends match, so a filename that genuinely contains one keeps it.
const WRAPPERS = [
  ["`", "`"],
  ["<", ">"],
  ['"', '"'],
  ["'", "'"],
] as const;

/**
 * Reads the body of a ```files fence into the workspace paths it names.
 *
 * The syntax is one path per line and nothing else, which is why the whole
 * line is the path: a name with spaces in it needs no quoting or escaping.
 * What is tolerated past that is the small set of near-misses Markdown habits
 * produce, because each one otherwise costs the user a file they were shown.
 * Anything else falls out here, and a path that survives still has to resolve
 * to a real file before it renders.
 */
export function parseFilesBlock(content: string): string[] {
  const paths: string[] = [];

  for (const line of content.split("\n")) {
    const path = readPath(line);
    // Deduplicated: a repeated path is a repeated card, and the agent listing
    // one file twice is not a request for two.
    if (path !== undefined && !paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths;
}

function readPath(line: string): string | undefined {
  const withoutMarker = line.trim().replace(LIST_MARKER, "");
  const link = MARKDOWN_LINK.exec(withoutMarker);
  const value = unwrap((link?.[1] ?? withoutMarker).trim());

  return value === "" ? undefined : normalizeTaskFilePath(value);
}

function unwrap(value: string): string {
  for (const [open, close] of WRAPPERS) {
    if (
      value.length > open.length + close.length &&
      value.startsWith(open) &&
      value.endsWith(close)
    ) {
      return unwrap(value.slice(open.length, -close.length).trim());
    }
  }

  return value;
}
