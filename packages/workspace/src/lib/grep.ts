import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { pathExists } from "./path-exists";
import { parseRipgrepLines, spawnRipgrep } from "./ripgrep";

const MAX_LINE_LENGTH = 2000;

/**
 * Separates the fields of a context line. Ripgrep uses `-` by default, which is
 * indistinguishable from a path that contains one, so we ask for a control
 * character instead: a line carrying it is a context line, and any other line
 * is a match.
 */
const CONTEXT_FIELD_SEPARATOR = "";

interface GrepMatch {
  /** A surrounding line pulled in by `contextLines`, not a match itself. */
  isContext: boolean;
  lineNum: number;
  lineText: string;
  modifiedAt: number;
  path: string;
}

interface GrepResult {
  hasErrors: boolean;
  matches: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
}

export async function grep(options: {
  contextLines?: number;
  cwd: AbsolutePath;
  include?: string;
  limit: number;
  pattern: string;
  searchPath: string;
  signal: AbortSignal;
}): Promise<GrepResult> {
  const { contextLines, cwd, include, limit, pattern, searchPath, signal } =
    options;

  const exists = await pathExists(cwd);
  if (!exists) {
    return {
      hasErrors: false,
      matches: [],
      totalMatches: 0,
      truncated: false,
    };
  }

  const args = [
    "--line-number",
    "--with-filename", // Include the filename in the output, even if there's only one match
    "--field-match-separator=|", // Use a custom field match separator to avoid parsing issues on Windows due to : in the path
    "--smart-case", // Searches case insensitively if the pattern is all lowercase, otherwise searches case sensitively
    "--path-separator=/", // Use / path separators on Windows for consistency
    "--hidden",
  ];

  // Don't use ripgrep's --sort option as it makes it single-threaded
  // We'll sort manually after getting results

  // Add include pattern (glob)
  if (include) {
    args.push("--glob", include);
  }

  if (contextLines && contextLines > 0) {
    args.push(
      "--context",
      String(contextLines),
      `--field-context-separator=${CONTEXT_FIELD_SEPARATOR}`,
    );
  }

  args.push("--regexp", pattern, "--", searchPath);

  const { code, stderr, stdout } = await spawnRipgrep({ args, cwd, signal });

  // If ripgrep returns no matches, it exits with code 1
  if (code === 1 && !stderr) {
    return {
      hasErrors: false,
      matches: [],
      totalMatches: 0,
      truncated: false,
    };
  }

  const hasErrors = code === 2;

  if (code !== 0 && code !== 2) {
    throw new Error(`ripgrep exited with code ${code ?? "unknown"}: ${stderr}`);
  }

  if (hasErrors && !stdout.trim()) {
    throw new Error(`ripgrep exited with code 2: ${stderr}`);
  }

  const lines = parseRipgrepLines(stdout);
  const parsed: Omit<GrepMatch, "modifiedAt">[] = [];

  for (const line of lines) {
    const parsedLine = parseGrepLine(line);
    if (parsedLine) {
      parsed.push(parsedLine);
    }
  }

  // Resolve mtimes once per file rather than once per match, since a single hot
  // file can hold thousands of matches.
  const modifiedAtByPath = new Map<string, number>();
  await Promise.all(
    [...new Set(parsed.map((match) => match.path))].map(async (filePath) => {
      // If filePath is already absolute, use it directly; otherwise join with cwd
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : absolutePathJoin(cwd, filePath);
      try {
        const stats = await fs.stat(absolutePath);
        modifiedAtByPath.set(filePath, stats.mtime.getTime());
      } catch {
        // Skip files that can't be stat'd
      }
    }),
  );

  const matches = parsed.flatMap((match) => {
    const modifiedAt = modifiedAtByPath.get(match.path);
    return modifiedAt === undefined ? [] : [{ ...match, modifiedAt }];
  });

  // Sort before applying the limit: capping in ripgrep's traversal order first
  // would pick an arbitrary set and then merely display that set by mtime,
  // hiding the recently touched files the ordering exists to surface. The sort
  // is stable, so matches within one file keep ripgrep's line order.
  matches.sort((a, b) => b.modifiedAt - a.modifiedAt);

  // The limit counts matches; the context lines around a kept match ride along
  // rather than competing with it for the budget.
  const limited: GrepMatch[] = [];
  let keptMatches = 0;
  let truncated = false;
  for (const match of matches) {
    if (!match.isContext) {
      if (keptMatches >= limit) {
        truncated = true;
        break;
      }
      keptMatches++;
    }
    limited.push(match);
  }
  if (truncated) {
    // Drop context that was leading up to the match we stopped before.
    while (limited.at(-1)?.isContext) {
      limited.pop();
    }
  }

  return {
    hasErrors,
    matches: limited,
    totalMatches: matches.filter((match) => !match.isContext).length,
    truncated,
  };
}

function parseGrepLine(line: string): null | Omit<GrepMatch, "modifiedAt"> {
  // Try the context separator first: a match line cannot be split by it into
  // the three fields this requires, so it falls through to the match branch.
  for (const [separator, isContext] of [
    [CONTEXT_FIELD_SEPARATOR, true],
    ["|", false],
  ] as const) {
    const [filePath, lineNumStr, ...lineTextParts] = line.split(separator);
    if (!filePath || !lineNumStr || lineTextParts.length === 0) {
      continue;
    }
    const lineNum = Number.parseInt(lineNumStr, 10);
    if (Number.isNaN(lineNum)) {
      continue;
    }
    const lineText = lineTextParts.join(separator);
    return {
      isContext,
      lineNum,
      lineText:
        lineText.length > MAX_LINE_LENGTH
          ? lineText.slice(0, Math.max(0, MAX_LINE_LENGTH)) + "..."
          : lineText,
      path: filePath,
    };
  }
  return null;
}
