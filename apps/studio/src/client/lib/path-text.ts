import { type TypedPath, typedFileName, typedPathOf } from "./typed-path";

/** One path found in a line of text somebody wrote, by where it is in the line. */
export interface FoundPath {
  /** Where the path starts in the line, quotes excluded. */
  from: number;
  path: TypedPath;
  /** Where it ends, exclusive. */
  to: number;
}

/** A line split into the paths it carries and the text around them. */
export type PathTextSegment =
  | { path: TypedPath; text: string; type: "path" }
  | { text: string; type: "text" };

// What a sentence puts after a path rather than inside one.
const TRAILING_PUNCTUATION = /[.,;:!?'"`]+$/u;

// What may stand right before a path a person wrote unquoted.
const OPENS_PATH = /[\s([<]/u;

const QUOTES = new Set(['"', "'", "`"]);

/**
 * Split a line into the paths on this computer it names and the text around
 * them, the way {@link findPaths} finds them.
 */
export function splitPaths(line: string, platform: string): PathTextSegment[] {
  const segments: PathTextSegment[] = [];
  let cursor = 0;
  for (const found of findPaths(line, platform)) {
    if (found.from > cursor) {
      segments.push({ text: line.slice(cursor, found.from), type: "text" });
    }
    segments.push({
      path: found.path,
      text: line.slice(found.from, found.to),
      type: "path",
    });
    cursor = found.to;
  }
  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor), type: "text" });
  }
  return segments;
}

/**
 * The paths on this computer a line of someone's own words names, for a
 * file or folder icon beside each.
 *
 * Read from the words alone, so it is a guess, and a guess held to what a
 * person plainly meant as a path: one starting from a place every computer
 * has (the root's own folders, the home folder as `~/`, a drive, a share, a
 * `file://` address), or from the root to a file with an extension. A path
 * from the root that is only slashes and words (`/release`, `/r/rust`) is a
 * command or a search as often as a path, and stays text, as does a path
 * relative to a folder nothing here names.
 *
 * Spaces are where it has to guess. A quoted path keeps its spaces, a path
 * that is the whole line keeps them when it ends in a file name or carries
 * a separator past the last one, and a Terminal's escaped space is part of a
 * name. Unquoted in a sentence, a word joins the path before it only when it
 * carries a separator itself (`My Docs/report.pdf`), or names a file where
 * the path so far names none (`My Report.pdf`).
 */
export function findPaths(line: string, platform: string): FoundPath[] {
  const whole = wholeLinePath(line, platform);
  if (whole) {
    return [whole];
  }
  const found: FoundPath[] = [];
  let at = 0;
  while (at < line.length) {
    const next = pathAt(line, at, platform);
    if (next) {
      found.push(next.found);
      at = next.end;
    } else {
      at += 1;
    }
  }
  return found;
}

/** The line as one path, spaces and all, when it plainly is one. */
function wholeLinePath(line: string, platform: string): FoundPath | undefined {
  const trimmed = line.trim();
  if (!/\s/u.test(trimmed) || QUOTES.has(trimmed[0] ?? "")) {
    return;
  }
  const path = strongPath(trimmed, platform);
  if (!path) {
    return;
  }
  const separator = platform === "win32" ? /[\\/]/u : /\//u;
  const afterLastSpace = trimmed.slice(trimmed.search(/\s\S*$/u) + 1);
  if (!typedFileName(path) && !separator.test(afterLastSpace)) {
    return;
  }
  const from = line.indexOf(trimmed);
  return { from, path, to: from + trimmed.length };
}

/** A path starting at `at`, quoted or not, and where reading should go on from. */
function pathAt(
  line: string,
  at: number,
  platform: string,
): { end: number; found: FoundPath } | undefined {
  const before = at === 0 ? " " : (line[at - 1] ?? " ");
  const char = line[at] ?? "";
  if (QUOTES.has(char) && (at === 0 || OPENS_PATH.test(before))) {
    const close = line.indexOf(char, at + 1);
    if (close === -1) {
      return;
    }
    const inside = line.slice(at + 1, close);
    const path = inside.trim() === inside && strongPath(inside, platform);
    return path
      ? { end: close + 1, found: { from: at + 1, path, to: close } }
      : undefined;
  }
  if (!OPENS_PATH.test(before)) {
    return;
  }
  let end = wordEnd(line, at, platform);
  let candidate = trimTrailing(line.slice(at, end));
  if (!strongPath(candidate, platform)) {
    return;
  }
  // Words after a space that read as more of the same path.
  for (;;) {
    if (!/^ \S/u.test(line.slice(end))) {
      break;
    }
    const nextEnd = wordEnd(line, end + 1, platform);
    const word = trimTrailing(line.slice(end + 1, nextEnd));
    const joined = `${line.slice(at, end)} ${word}`;
    const continues =
      word !== "" &&
      (hasInnerSeparator(word, platform) ||
        (!namesFile(candidate) && namesFile(joined))) &&
      strongPath(joined, platform) !== undefined;
    if (!continues) {
      break;
    }
    end = nextEnd;
    candidate = trimTrailing(line.slice(at, end));
  }
  const path = strongPath(candidate, platform);
  if (!path) {
    return;
  }
  return {
    end,
    found: { from: at, path, to: at + candidate.length },
  };
}

/** Where a word starting at `at` ends: the next space, unless a Terminal escaped it. */
function wordEnd(line: string, at: number, platform: string) {
  let end = at;
  while (end < line.length) {
    const char = line[end] ?? "";
    if (/\s/u.test(char)) {
      break;
    }
    // A Mac or Linux Terminal escapes a space in a name with a backslash.
    if (char === "\\" && platform !== "win32" && line[end + 1] === " ") {
      end += 2;
      continue;
    }
    end += 1;
  }
  return end;
}

/** Whether a word carries a separator after its first letter, as the rest of a path does. */
function hasInnerSeparator(word: string, platform: string) {
  return (platform === "win32" ? /^[^\\/]+[\\/]/u : /^[^/]+\//u).test(word);
}

/**
 * The sentence's punctuation off the end of a path, and a closing
 * parenthesis the path did not open.
 */
function trimTrailing(word: string) {
  let trimmed = word.replace(TRAILING_PUNCTUATION, "");
  while (
    trimmed.endsWith(")") &&
    trimmed.split(")").length > trimmed.split("(").length
  ) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }
  return trimmed;
}

/** Whether a path's last name is a file's, by its extension. */
function namesFile(path: string) {
  return /^[^.].*\.[^.\s\\/]+$/u.test(path.split(/[\\/]/u).at(-1) ?? "");
}

/** Words as a path when they plainly are one; see {@link findPaths}. */
function strongPath(words: string, platform: string): TypedPath | undefined {
  if (words === "" || words !== words.trim()) {
    return;
  }
  const path = typedPathOf(words, platform);
  if (!path) {
    return;
  }
  if (/^file:/iu.test(words) || /^~[\\/]./u.test(words)) {
    return path;
  }
  // The home folder on its own is a word in a sentence as often as a place.
  if (words.startsWith("~")) {
    return;
  }
  if (!path.alsoSearch) {
    return path.shown === "/" ? undefined : path;
  }
  return path.shown.split("/").length > 2 && typedFileName(path)
    ? path
    : undefined;
}

/** How long a path's label runs before its middle folders give way to an ellipsis. */
export const MAX_PATH_LABEL_LENGTH = 40;

/**
 * A path as a short label, for a chip with the whole path a hover away: the
 * place it starts from, an ellipsis for the folders in its middle, then the
 * last two names, or the last one alone when two still run long. The end is
 * what is kept because the end is what names the thing.
 */
export function shortPathLabel(path: string) {
  if (path.length <= MAX_PATH_LABEL_LENGTH) {
    return path;
  }
  const separator = path.includes("/") ? "/" : "\\";
  const names = path.split(/[\\/]/u);
  // A path from the root starts with an empty name before its first separator.
  const headCount = names[0] === "" ? 2 : 1;
  const head = names.slice(0, headCount).join(separator);
  for (const keep of [2, 1]) {
    if (names.length - headCount <= keep) {
      return path;
    }
    const label = [head, "…", ...names.slice(-keep)].join(separator);
    if (label.length <= MAX_PATH_LABEL_LENGTH || keep === 1) {
      return label;
    }
  }
  return path;
}
