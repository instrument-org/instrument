import fs from "node:fs/promises";
import path from "node:path";

import {
  CHAT_FILE_NAME,
  CHAT_FOLDER_NAMES,
  FOLDER_VARIABLES,
} from "../../constants";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { isSystemClutter } from "../system-clutter";

export type FileTouch =
  SessionMessageDataPart.StepFactsDataPart["files"][number];

/** What's in a folder that no one means by "the files it changed". */
const SKIPPED = new Set([
  ".git",
  ".venv",
  "__pycache__",
  CHAT_FOLDER_NAMES.toolOutput,
  "node_modules",
]);

/**
 * How far before a call's start a file's modified time may fall and still be
 * the call's: a filesystem stamps files from a coarser clock than `Date.now()`
 * reads, by up to about 16ms on Windows.
 */
const CLOCK_SLACK_MS = 50;

/**
 * Whether a file is the app's or the system's rather than the work's: the
 * transcript the app keeps in a chat's folder, a background command's log, and
 * what file managers and programs leave beside things.
 */
function isTheWork(file: string): boolean {
  const name = path.basename(file);
  return (
    name !== CHAT_FILE_NAME &&
    !isSystemClutter(name) &&
    !file.split(/[/\\]/).some((segment) => SKIPPED.has(segment))
  );
}

/** How many files a look at one folder reads before it stops. */
const FILES_PER_FOLDER = 2000;

/** How many paths named in a command are checked. */
const NAMED_PATHS_CHECKED = 64;

/** How many files one call records. Past this it says how many more. */
const FILES_KEPT = 100;

/** A file's size and time, by path. */
type FolderSnapshot = Map<string, { mtimeMs: number; size: number }>;

/**
 * What the folders hold now, by size and modified time. A script is a black
 * box, so what it did is read from the disk: comparing two of these says what
 * changed whatever the program was, with nothing about it understood.
 */
async function snapshotFolders(
  folders: readonly string[],
): Promise<FolderSnapshot> {
  const snapshot: FolderSnapshot = new Map();
  await Promise.all(folders.map((folder) => addFolder(folder, snapshot)));
  return snapshot;
}

async function addFolder(root: string, snapshot: FolderSnapshot) {
  const waiting = [root];
  let read = 0;
  while (waiting.length > 0 && read < FILES_PER_FOLDER) {
    const folder = waiting.pop();
    if (folder === undefined) {
      break;
    }
    const entries = await fs
      .readdir(folder, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (read >= FILES_PER_FOLDER) {
        break;
      }
      const at = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) {
          waiting.push(at);
        }
      } else if (entry.isFile() && isTheWork(at)) {
        read += 1;
        const stat = await fs.stat(at).catch(() => undefined);
        if (stat) {
          snapshot.set(at, { mtimeMs: stat.mtimeMs, size: stat.size });
        }
      }
    }
  }
}

/** What differs between two looks at the same folders. */
function changesBetween(
  before: FolderSnapshot,
  after: FolderSnapshot,
): FileTouch[] {
  const touches: FileTouch[] = [];
  for (const [file, now] of after) {
    const was = before.get(file);
    if (!was) {
      touches.push({ change: "created", path: file, via: "disk" });
    } else if (was.mtimeMs !== now.mtimeMs || was.size !== now.size) {
      touches.push({ change: "changed", path: file, via: "disk" });
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) {
      touches.push({ change: "deleted", path: file, via: "disk" });
    }
  }
  return touches;
}

const QUOTED = /"([^"\n]+)"|'([^'\n]+)'/g;
const BARE =
  /(?:^|[\s=(>|;:,])((?:[A-Za-z]:[\\/]|~|\$\w+|\$\{\w+\}|\.{0,2}\/|\w)[^\s"'`|;&<>()=,:]*\.\w{1,8}|(?:~|\$\w+|\$\{\w+\}|\.{0,2})\/[^\s"'`|;&<>()=,:]+)/g;
const CD = /(?:^|[;&|(]|\n)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g;
const LOOKS_LIKE_A_PATH = /[/\\]|\.\w{1,8}$/;

/**
 * Every file path a command or its output seems to name: its quoted words and
 * anything path-shaped. It need not be right about any of them, since each is
 * only checked against the disk. A script's names come from its own text and
 * the lines it prints.
 */
export function pathsNamedIn(text: string): string[] {
  const named = new Set<string>();
  for (const match of text.matchAll(QUOTED)) {
    const word = (match[1] ?? match[2])?.trim();
    if (word && word.length < 512 && LOOKS_LIKE_A_PATH.test(word)) {
      named.add(word);
    }
  }
  for (const match of text.replaceAll(QUOTED, " ").matchAll(BARE)) {
    if (match[1]) {
      named.add(match[1]);
    }
  }
  return [...named].filter((word) => !/^(?:[a-z]+:)?\/\//.test(word));
}

/** The folders a command moves to, which its relative paths are relative to. */
export function foldersEntered(command: string): string[] {
  return [...command.matchAll(CD)].flatMap((match) => {
    const folder = match[1] ?? match[2] ?? match[3];
    return folder ? [folder] : [];
  });
}

/** Where a path a command wrote is on this computer, given where it may be read from. */
function placesOf(
  word: string,
  {
    bases,
    home,
    variables,
  }: {
    bases: readonly string[];
    home: string | undefined;
    variables: Readonly<Record<string, string>>;
  },
): string[] {
  const expanded = word.replace(
    /^\$\{?(\w+)\}?/,
    (whole, name: string) => variables[name] ?? whole,
  );
  if (expanded.startsWith("$")) {
    return [];
  }
  if (expanded.startsWith("~/")) {
    return home === undefined ? [] : [path.join(home, expanded.slice(2))];
  }
  return path.isAbsolute(expanded)
    ? [path.normalize(expanded)]
    : bases.map((base) => path.resolve(base, expanded));
}

/**
 * Paths the call's words name that the disk says changed during it. This is
 * what finds a file outside the chat's folders, wherever a script put it.
 */
async function namedPathChanges({
  known,
  places,
  startedAtMs,
}: {
  /** Files already told, which are not told twice. */
  known: ReadonlySet<string>;
  places: readonly string[];
  startedAtMs: number;
}): Promise<FileTouch[]> {
  const unique = [...new Set(places)]
    .filter((place) => !known.has(place) && isTheWork(place))
    .slice(0, NAMED_PATHS_CHECKED);
  const since = startedAtMs - CLOCK_SLACK_MS;
  const touches = await Promise.all(
    unique.map(async (place): Promise<FileTouch | undefined> => {
      const stat = await fs.stat(place).catch(() => undefined);
      if (!stat?.isFile() || stat.mtimeMs < since) {
        return undefined;
      }
      return {
        change: stat.birthtimeMs >= since ? "created" : "changed",
        path: place,
        via: "disk",
      };
    }),
  );
  return touches.filter((touch) => touch !== undefined);
}

/** The programs that read the files they are named with. */
const READERS = new Set([
  "awk",
  "bat",
  "cat",
  "diff",
  "file",
  "grep",
  "head",
  "jq",
  "less",
  "more",
  "node",
  "python",
  "python3",
  "rg",
  "sed",
  "stat",
  "tail",
  "wc",
]);

/**
 * The files a command's words say it reads, which exist. No disk check can see
 * a read, so this is a guess from the words, and recorded as one.
 */
async function readsNamedIn(
  command: string,
  placesFor: (word: string) => string[],
  known: ReadonlySet<string>,
): Promise<FileTouch[]> {
  const places = new Set<string>();
  for (const segment of command.split(/[|;&\n]+/)) {
    const [program, ...rest] = segment.trim().split(/\s+/);
    if (program === undefined || !READERS.has(program)) {
      continue;
    }
    for (const word of rest) {
      if (!word.startsWith("-")) {
        for (const place of placesFor(word.replaceAll(/^["']|["']$/g, ""))) {
          places.add(place);
        }
      }
    }
  }
  const touches = await Promise.all(
    [...places]
      .filter((place) => !known.has(place) && isTheWork(place))
      .slice(0, NAMED_PATHS_CHECKED)
      .map(async (place): Promise<FileTouch | undefined> => {
        const stat = await fs.stat(place).catch(() => undefined);
        return stat?.isFile()
          ? { change: "read", path: place, via: "command" }
          : undefined;
      }),
  );
  return touches.filter((touch) => touch !== undefined);
}

/** A look around one shell call, taken before it runs. */
export interface CallWatch {
  before: FolderSnapshot;
  folders: readonly string[];
  home: string | undefined;
  startedAtMs: number;
  variables: Readonly<Record<string, string>>;
  workFolder: string;
}

/** Starts watching: what the chat's folders hold before the call. */
export async function watchCall({
  folders,
  home,
  outputFolder,
  workFolder,
}: {
  folders: readonly string[];
  home: string | undefined;
  outputFolder: string | undefined;
  workFolder: string;
}): Promise<CallWatch> {
  return {
    before: await snapshotFolders(folders),
    folders,
    home,
    startedAtMs: Date.now(),
    variables: {
      [FOLDER_VARIABLES.work]: workFolder,
      ...(outputFolder !== undefined && {
        [FOLDER_VARIABLES.output]: outputFolder,
      }),
    },
    workFolder,
  };
}

/**
 * The files a call touched, told by the disk where it can and the command's
 * words for what it read, with how many it left out.
 */
export async function fileTouches(
  watch: CallWatch,
  { command, output }: { command: string; output: string },
): Promise<{ files: FileTouch[]; moreFiles?: number }> {
  const disk = changesBetween(
    watch.before,
    await snapshotFolders(watch.folders),
  );
  const bases = [
    watch.workFolder,
    ...foldersEntered(command).flatMap((folder) =>
      placesOf(folder, {
        bases: [watch.workFolder],
        home: watch.home,
        variables: watch.variables,
      }),
    ),
  ];
  const placesFor = (word: string) =>
    placesOf(word, { bases, home: watch.home, variables: watch.variables });
  const known = new Set(disk.map((touch) => touch.path));
  const named = await namedPathChanges({
    known,
    places: pathsNamedIn(`${command}\n${output}`).flatMap(placesFor),
    startedAtMs: watch.startedAtMs,
  });
  const changed = [...disk, ...named];
  const reads = await readsNamedIn(
    command,
    placesFor,
    new Set(changed.map((touch) => touch.path)),
  );
  const all = [...changed, ...reads];
  return {
    files: all.slice(0, FILES_KEPT),
    ...(all.length > FILES_KEPT && { moreFiles: all.length - FILES_KEPT }),
  };
}
