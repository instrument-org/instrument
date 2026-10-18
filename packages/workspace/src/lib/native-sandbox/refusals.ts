import { existsSync } from "node:fs";
import path from "node:path";

import { ruleRefusal } from "../permissions/rules-fs";
import { type Reach, reachOf, type Rules } from "../permissions/rules";
import { type NativeReach } from "./reach";

/** What separates a path's parts in a program's output here. */
const SEPARATOR = process.platform === "win32" ? /[\\/]/ : /\//;

const MISSING = /no such file/i;

/**
 * How a program says the system refused it a path, in either case: Node and
 * Go write `permission denied` and `no such file or directory` in lowercase.
 */
const REFUSALS = [
  /not permitted/i,
  /permission denied/i,
  // Windows' own wording, as a Rust or C program prints it.
  /access is denied/i,
  // .NET's, as PowerShell prints it: `Access to the path 'C:\...' is denied.`
  /access to the path .+ is denied/i,
  MISSING,
  /read-only file system/i,
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
function pathsNamedIn(
  line: string,
  /** Where in the line the refusal starts. */
  refusalAt: number,
): string[] {
  const quoted = [
    ...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|‘([^’]*)’|“([^”]*)”/g),
  ]
    .map((match) => match.slice(1).find((group) => group !== undefined) ?? "")
    .filter((span) => SEPARATOR.test(span));
  if (quoted.length > 0) {
    return quoted.toReversed();
  }
  const end = line.lastIndexOf(": ", refusalAt);
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
 * The first path a command's output says it was not permitted to use that
 * the rules keep from it, so the agent is told why rather than left to read
 * a bare "Operation not permitted" as something to work around.
 */
export function refusedPathIn(
  output: string,
  reach: NativeReach,
  /** The command's working folder, which a relative path is read against. */
  cwd?: string,
  {
    appDataOnly = false,
  }: {
    /**
     * Only a path in the app's own data, which nothing opens and no card
     * asks for; any other refused path is passed over.
     */
    appDataOnly?: boolean;
  } = {},
): undefined | Refused {
  for (const line of output.split("\n")) {
    // Seatbelt refuses with "Operation not permitted"; bubblewrap passes a
    // closed folder through with only what opens in it, and leaves the home
    // folder read-only, so the same refusal reads as a missing file or a
    // read-only disk there.
    const refusalAt = REFUSALS.map((each) => line.search(each)).find(
      (at) => at !== -1,
    );
    if (refusalAt === undefined) {
      continue;
    }
    // A program names a path the way it was given, so `closed/a.txt` is
    // read against the cwd.
    for (const named of pathsNamedIn(line, refusalAt)) {
      if (!path.isAbsolute(named) && cwd === undefined) {
        continue;
      }
      const hostPath = path.resolve(cwd ?? "/", named);
      // A missing file can only be a closed read; anything else may have
      // been a change.
      const missing = MISSING.test(line);
      // A sandbox hides what is on disk, so a path missing here as well as
      // the folder it would be in is missing for the program too, as a
      // config file it only looked for is.
      if (
        missing &&
        !existsSync(hostPath) &&
        !existsSync(path.dirname(hostPath))
      ) {
        continue;
      }
      const op = missing ? "read" : "write";
      const decided = reachOf(reach.rules, hostPath, op);
      if (
        decided.level !== "allow" &&
        (!appDataOnly || decided.rule?.appData === true)
      ) {
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

/**
 * What the agent reads when Node stopped a script because the sandbox
 * refused it a package.json in a folder above the script. The `node`
 * command's own preload reads past that, so this is a Node another program
 * started; no card asks for the folder, which holds no work.
 */
export function packageScopeNote(output: string): string | undefined {
  const named =
    /Cannot read package config (.+?package\.json): (?:operation not permitted|permission denied)/i.exec(
      output,
    )?.[1];
  return named === undefined
    ? undefined
    : `The sandbox refused Node's look for a package.json above the script (${named.replace(/^\\\\\?\\/, "")}). \`node <script>\` from this shell reads past that; for a script another program starts, a package.json beside the script (\`{}\` is enough) ends the look there.`;
}
