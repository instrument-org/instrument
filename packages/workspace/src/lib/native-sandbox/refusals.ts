import path from "node:path";

import { ruleRefusal } from "../permissions/rules-fs";
import { type Reach, reachOf, type Rules } from "../permissions/rules";
import { type NativeReach } from "./reach";

/** What separates a path's parts in a program's output here. */
const SEPARATOR = process.platform === "win32" ? /[\\/]/ : /\//;

const REFUSALS = [
  "not permitted",
  "Permission denied",
  // Windows' own wording, as a Rust or C program prints it.
  "Access is denied",
  "No such file",
  "Read-only file system",
];

/**
 * The paths a line refusing a path names, the likeliest first. A path in
 * quotes is whole, spaces and apostrophes included (`'Acme Corp/a.csv'`,
 * `"Bob's Files"`, GNU's `‘/home/x’`), and the last one quoted is the one
 * refused. Unquoted, the path runs from the first word with a slash up to
 * the `: <refusal>` that ends the line (`cp: /Users/s/Acme Corp/a.csv:
 * Operation not permitted`), past what a shell names first
 * (`/bin/sh: 1: cannot create <path>`). Failing both, each word with a
 * slash, last first.
 */
function pathsNamedIn(line: string, refusal: string): string[] {
  const quoted = [
    ...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|‘([^’]*)’|“([^”]*)”/g),
  ]
    .map((match) => match.slice(1).find((group) => group !== undefined) ?? "")
    .filter((span) => SEPARATOR.test(span));
  if (quoted.length > 0) {
    return quoted.toReversed();
  }
  const end = line.lastIndexOf(": ", line.indexOf(refusal));
  if (end !== -1) {
    const words = (line.slice(0, end).split(": ").at(-1) ?? "").split(" ");
    const first = words.findIndex((word) => SEPARATOR.test(word));
    if (first !== -1) {
      return [words.slice(first).join(" ")];
    }
  }
  return [
    ...line.matchAll(/(?<=^|[\s:'"`(=[‘“])[^\s:'"`‘’“”]*\/[^\s:'"`‘’“”]*/g),
    // A drive-letter path, whose colon the pattern above stops at.
    ...(process.platform === "win32"
      ? line.matchAll(/(?<=^|[\s'"`(=[‘“])[A-Za-z]:\\[^\s:'"`‘’“”]*/g)
      : []),
  ]
    .map((match) => match[0])
    .toReversed();
}

/** A path the rules kept a native command from, and how it was used. */
interface Refused {
  hostPath: string;
  /** Whether the output says the path was a folder being made. */
  isDirectory: boolean;
  op: "read" | "write";
  reach: Reach;
  rules: Rules;
}

/**
 * The first path a failed command's output says it was not permitted to use
 * that the rules keep from it, so the agent is told why rather than left to
 * read a bare "Operation not permitted" as something to work around.
 */
export function refusedPathIn(
  output: string,
  reach: NativeReach,
  /** The command's working folder, which a relative path is read against. */
  cwd?: string,
): undefined | Refused {
  for (const line of output.split("\n")) {
    // Seatbelt refuses with "Operation not permitted"; bubblewrap leaves a
    // closed folder empty and a home folder read-only, so the same refusal
    // reads as a missing file or a read-only disk there.
    const refusal = REFUSALS.find((each) => line.includes(each));
    if (refusal === undefined) {
      continue;
    }
    // A program names a path the way it was given, so `closed/a.txt` is
    // read against the cwd.
    for (const named of pathsNamedIn(line, refusal)) {
      if (!path.isAbsolute(named) && cwd === undefined) {
        continue;
      }
      const hostPath = path.resolve(cwd ?? "/", named);
      // A missing file can only be a closed read; anything else may have
      // been a change.
      const op = line.includes("No such file") ? "read" : "write";
      const decided = reachOf(reach.rules, hostPath, op);
      if (decided.level !== "allow") {
        return {
          hostPath,
          // `mkdir: cannot create directory`, git's `cannot mkdir`, Node's
          // `EROFS: ..., mkdir`.
          isDirectory: /\bmkdir\b|create directory/.test(line),
          op,
          reach: decided,
          rules: reach.rules,
        };
      }
    }
  }
  return undefined;
}

/** What the agent reads when the rules stopped a native command. */
export function refusalNote(refused: Refused): string | undefined {
  return ruleRefusal({
    afterAsk: "Run the command again once they allow it.",
    hostPath: refused.hostPath,
    isDirectory: refused.isDirectory,
    op: refused.op,
    reach: refused.reach,
    rules: refused.rules,
    // Native commands are wrapped on macOS and Linux, where a path in the
    // home folder is said from `~`.
    spell: (hostPath) => {
      const { home } = refused.rules;
      return hostPath === home
        ? "~"
        : hostPath.startsWith(`${home}/`)
          ? `~/${hostPath.slice(home.length + 1)}`
          : hostPath;
    },
  });
}
