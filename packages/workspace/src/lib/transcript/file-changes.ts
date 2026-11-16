import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES, FOLDER_VARIABLES } from "../../constants";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { pathIsWithin } from "../path-is-within";
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
 * Whether a file is the app's or the system's rather than the work's: a
 * background command's log, and what file managers and programs leave beside
 * things.
 */
function isTheWork(file: string): boolean {
  const name = path.basename(file);
  return (
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
interface FolderSnapshot {
  files: Map<string, { mtimeMs: number; size: number }>;
  /** A folder held more than a look reads, so a file missing may be unread. */
  isPartial: boolean;
}

/**
 * What the places hold now, by size and modified time: every file under a
 * folder, a file itself, and nothing for a place not there yet. A script is a
 * black box, so what it did is read from the disk: comparing two of these
 * says what changed whatever the program was, with nothing about it
 * understood.
 */
async function snapshotPlaces(
  places: readonly string[],
): Promise<FolderSnapshot> {
  const snapshot: FolderSnapshot = { files: new Map(), isPartial: false };
  await Promise.all(places.map((place) => addPlace(place, snapshot)));
  return snapshot;
}

async function addPlace(place: string, snapshot: FolderSnapshot) {
  const stat = await fs.stat(place).catch(() => undefined);
  if (stat?.isDirectory()) {
    await addFolder(place, snapshot);
  } else if (stat?.isFile() && isTheWork(place)) {
    snapshot.files.set(place, { mtimeMs: stat.mtimeMs, size: stat.size });
  }
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
        snapshot.isPartial = true;
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
          snapshot.files.set(at, { mtimeMs: stat.mtimeMs, size: stat.size });
        }
      }
    }
  }
}

/**
 * What differs between two looks at the same folders. Where either stopped at
 * its limit, a file only one of them read says nothing by itself, so a new one
 * counts only by its time and nothing counts as deleted.
 */
function changesBetween(
  before: FolderSnapshot,
  after: FolderSnapshot,
  since: number,
): FileTouch[] {
  const isPartial = before.isPartial || after.isPartial;
  const touches: FileTouch[] = [];
  for (const [file, now] of after.files) {
    const was = before.files.get(file);
    if (!was) {
      if (!isPartial || now.mtimeMs >= since) {
        touches.push({ change: "created", path: file, via: "disk" });
      }
    } else if (was.mtimeMs !== now.mtimeMs || was.size !== now.size) {
      touches.push({ change: "changed", path: file, via: "disk" });
    }
  }
  if (!isPartial) {
    for (const file of before.files.keys()) {
      if (!after.files.has(file)) {
        touches.push({ change: "deleted", path: file, via: "disk" });
      }
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

/**
 * A folder variable written alone as a word (`"$INSTRUMENT_FILES"`,
 * `${INSTRUMENT_PROJECT}/`), which names the folder itself and so is not
 * path-shaped enough for {@link pathsNamedIn}.
 */
const LONE_VARIABLE = /(?:^|[\s"'=(])\$\{?(\w+)\}?\/?(?=$|[\s"'`;&|)])/g;

/**
 * The places in the shared folders a command names before it runs: paths in
 * its words, folders it moves to, and a shared folder's variable on its own,
 * kept to those under `shared` and left out where one already covers another.
 */
function sharedPlacesNamed(
  command: string,
  {
    home,
    shared,
    variables,
    workFolder,
  }: {
    home: string | undefined;
    shared: readonly string[];
    variables: Readonly<Record<string, string>>;
    workFolder: string;
  },
): string[] {
  const entered = foldersEntered(command).flatMap((folder) =>
    placesOf(folder, { bases: [workFolder], home, variables }),
  );
  const bases = [workFolder, ...entered];
  const lone = [...command.matchAll(LONE_VARIABLE)].flatMap((match) => {
    const folder = match[1] === undefined ? undefined : variables[match[1]];
    return folder === undefined ? [] : [folder];
  });
  const places = [
    ...entered,
    ...lone,
    ...pathsNamedIn(command).flatMap((word) =>
      placesOf(word, { bases, home, variables }),
    ),
  ]
    .map((place) => path.resolve(place))
    .filter(
      (place) =>
        !pathIsWithin(place, workFolder) &&
        shared.some((folder) => pathIsWithin(place, folder)) &&
        isTheWork(place),
    );
  const unique = [...new Set(places)].toSorted();
  return unique
    .filter(
      (place) =>
        !unique.some((other) => other !== place && pathIsWithin(place, other)),
    )
    .slice(0, NAMED_PATHS_CHECKED);
}

/** A look around one shell call, taken before it runs. */
export interface CallWatch {
  before: FolderSnapshot;
  home: string | undefined;
  /** What the look compares: the work folder and what the command names. */
  places: readonly string[];
  startedAtMs: number;
  variables: Readonly<Record<string, string>>;
  workFolder: string;
}

/**
 * Starts watching: what the chat's work folder holds before the call, and
 * what the places the command names in the Files folder and the project's
 * folder hold. Those two are shared with every chat, its tasks, the person
 * and the sync engine, so a change there is the call's only where the call's
 * own words point; the work folder is the chat's alone, so all of it is
 * compared.
 */
export async function watchCall({
  command,
  filesFolder,
  home,
  projectFolder,
  workFolder,
}: {
  command: string;
  filesFolder: string | undefined;
  home: string | undefined;
  projectFolder: string | undefined;
  workFolder: string;
}): Promise<CallWatch> {
  const variables = {
    [FOLDER_VARIABLES.work]: workFolder,
    ...(filesFolder !== undefined && {
      [FOLDER_VARIABLES.files]: filesFolder,
    }),
    ...(projectFolder !== undefined && {
      [FOLDER_VARIABLES.project]: projectFolder,
    }),
  };
  const shared = [filesFolder, projectFolder].filter(
    (folder) => folder !== undefined,
  );
  const places = [
    workFolder,
    ...sharedPlacesNamed(command, { home, shared, variables, workFolder }),
  ];
  return {
    before: await snapshotPlaces(places),
    home,
    places,
    startedAtMs: Date.now(),
    variables,
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
    await snapshotPlaces(watch.places),
    watch.startedAtMs - CLOCK_SLACK_MS,
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
