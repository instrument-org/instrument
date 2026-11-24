import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { hasWorkspaceConfig } from "../workspace-config";
import { workspaceMachineDir } from "../workspace-machine-dir";
import { permissionsFileIn } from "./rules";

/**
 * The folders macOS has answered for, kept so that code which must never
 * raise macOS's prompt (a walk nobody asked macOS about) knows where it may
 * read. macOS asks about a folder once and keeps the answer until the person
 * changes it in System Settings, so a folder that a read the person caused
 * has already been into is read again with no prompt, whichever way the
 * answer went.
 *
 * An answer is only ever recorded from such a read, never worked out.
 */

/** The Mac's data volume, which shows its folders a second time under this path. */
const MAC_DATA_VOLUME = "/system/volumes/data";

/**
 * The folders of the home folder that one answer from macOS covers whole,
 * each its own switch in System Settings. iCloud Drive's is its own folder
 * of documents: the folders other apps keep beside it are theirs.
 */
const ANSWERED_WHOLE = [
  "Desktop",
  "Documents",
  "Downloads",
  "Library/Mobile Documents/com~apple~CloudDocs",
];

/**
 * The folders of the home folder that hold places macOS guards one by one
 * (other apps' data, the photo and music libraries), so an answer for one
 * folder in them says nothing of the next.
 */
const ANSWERED_BY_FOLDER = ["Library", "Movies", "Music", "Pictures"];

/** How many folders the record keeps, the newest: a bound on a file that every read of a new folder adds to. */
const ANSWERS_MAX = 500;

/** The key of the record in this computer's permissions file. */
const ANSWERS_KEY = "macosAnsweredFolders";

type Facts = { home: string };

/** A path as the record and the rules compare it: lowercased, as the Mac's disks compare names. */
function spelledAlike(folder: string): string {
  const lower = folder.toLowerCase();
  return isWithin(lower, MAC_DATA_VOLUME)
    ? lower.slice(MAC_DATA_VOLUME.length) || "/"
    : lower;
}

function isWithin(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(`${outer}/`);
}

/**
 * What an answer has to be on record for before `folder` is read without a
 * prompt: nothing (undefined) for a folder macOS does not guard, the folder
 * `whole` whose one answer covers everything in it, or the folder itself.
 * `folder` is where the folder really is, with no link in its path.
 *
 * iCloud Drive shows Desktop and Documents inside it when it keeps them in
 * step, and those are answered for as the home folder's own.
 */
function macosFolderGuard(
  folder: string,
  { home }: Facts,
): undefined | { whole?: string } {
  const at = spelledAlike(folder);
  const inHome = (name: string) => `${home}/${name}`.toLowerCase();
  const iCloud = inHome("Library/Mobile Documents/com~apple~CloudDocs");
  for (const name of ["Desktop", "Documents"]) {
    if (isWithin(at, `${iCloud}/${name.toLowerCase()}`)) {
      return { whole: inHome(name) };
    }
  }
  const whole = ANSWERED_WHOLE.map(inHome).find((root) => isWithin(at, root));
  if (whole !== undefined) {
    return { whole };
  }
  const disk = /^\/volumes\/[^/]+/.exec(at)?.[0];
  if (disk !== undefined) {
    return { whole: disk };
  }
  return ANSWERED_BY_FOLDER.map(inHome).some((root) => isWithin(at, root))
    ? {}
    : undefined;
}

/**
 * Whether reading `folder` could raise macOS's prompt, going by `answered`:
 * true for a folder macOS guards with no answer on record for it or for the
 * folder whose answer covers it. Decided from the path alone.
 */
export function macosMayAsk(
  folder: string,
  { answered, home }: Facts & { answered: ReadonlySet<string> },
): boolean {
  const guard = macosFolderGuard(folder, { home });
  if (guard === undefined || answered.has(spelledAlike(folder))) {
    return false;
  }
  return guard.whole === undefined || !answered.has(guard.whole);
}

/**
 * Whether reading some folder below `folder` could raise macOS's prompt,
 * going by `answered`: true for a folder above one macOS guards, for one in
 * a place answered for folder by folder, and for iCloud Drive's own folder,
 * which shows Desktop and Documents. False only where every folder below is
 * covered by an answer on record or guarded by nothing.
 */
export function macosMayAskBelow(
  folder: string,
  { answered, home }: Facts & { answered: ReadonlySet<string> },
): boolean {
  const at = spelledAlike(folder);
  const holds = (inner: string) => at === "/" || isWithin(inner, at);
  const guard = macosFolderGuard(folder, { home });
  if (guard === undefined) {
    return (
      holds(home.toLowerCase()) ||
      holds("/volumes") ||
      isWithin(MAC_DATA_VOLUME, folder.toLowerCase())
    );
  }
  if (guard.whole === undefined || !answered.has(guard.whole)) {
    return true;
  }
  return (
    at === `${home}/Library/Mobile Documents/com~apple~CloudDocs`.toLowerCase()
  );
}

/** How many links one path may lead through before it is given up on. */
const LINKS_MAX = 40;

/**
 * Where a path really is, every link in it followed by hand, or undefined
 * for a path that is not there or that `keepsOut` stops.
 *
 * Each part is looked at with `lstat`, which macOS answers inside a guarded
 * folder without asking, and a link is read only where `keepsOut` allows the
 * link's own place, so resolving never reads a folder's contents and never
 * reads a link kept in a place nobody answered for. POSIX paths only.
 */
export async function resolveWithoutAsking(
  spelled: string,
  keepsOut: (at: string) => boolean,
): Promise<string | undefined> {
  const partsOf = (path: string) => path.split("/").filter(Boolean);
  let rest = partsOf(nodePath.posix.resolve(spelled));
  let at = "/";
  let links = 0;
  for (let name = rest.shift(); name !== undefined; name = rest.shift()) {
    const next = nodePath.posix.join(at, name);
    const stats = await fs.lstat(next).catch(() => null);
    if (stats === null) {
      return undefined;
    }
    if (!stats.isSymbolicLink()) {
      at = next;
      continue;
    }
    links += 1;
    if (links > LINKS_MAX || keepsOut(next)) {
      return undefined;
    }
    const target = await fs.readlink(next).catch(() => null);
    if (target === null) {
      return undefined;
    }
    rest = [...partsOf(nodePath.posix.resolve(at, target)), ...rest];
    at = "/";
  }
  return at;
}

/**
 * The record of answered folders in one file, for one home folder. Off
 * macOS it records nothing and answers with nothing.
 */
export function createMacosFolderAnswers({
  file,
  home = os.homedir(),
  platform = process.platform,
}: {
  file: () => string | undefined;
  home?: string;
  platform?: NodeJS.Platform;
}) {
  let loading: Promise<Set<string>> | undefined;

  function load(): Promise<Set<string>> {
    loading ??= (async () => {
      const at = file();
      const read = at === undefined ? undefined : await readJsonRecord(at);
      const kept = read?.kind === "read" ? read.record[ANSWERS_KEY] : [];
      return new Set(
        Array.isArray(kept)
          ? kept.filter((each) => typeof each === "string")
          : [],
      );
    })();
    return loading;
  }

  return {
    /** The folders on record, each spelled as `macosMayAsk` compares them. */
    async answered(): Promise<ReadonlySet<string>> {
      return platform === "darwin" ? load() : new Set();
    },

    /**
     * Records what a listing of `hostPath`, made for the person, found:
     * `open` is an answer for that very folder, and `system`, macOS's own
     * refusal, is one only for a folder whose answer covers it whole, since
     * macOS refuses other folders for reasons it never asked about. A
     * folder macOS does not guard is not recorded.
     */
    async note(hostPath: string, looked: "open" | "system"): Promise<void> {
      if (platform !== "darwin") {
        return;
      }
      const answered = await load();
      const real = await resolveWithoutAsking(hostPath, (at) =>
        macosMayAsk(at, { answered, home }),
      );
      const guard = real && macosFolderGuard(real, { home });
      if (real === undefined || !guard) {
        return;
      }
      const folder = spelledAlike(real);
      if (
        !macosMayAsk(real, { answered, home }) ||
        (looked === "system" && guard.whole !== folder)
      ) {
        return;
      }
      answered.add(folder);
      const at = file();
      if (at !== undefined) {
        await updateJsonRecord(at, () => ({
          [ANSWERS_KEY]: [...answered].slice(-ANSWERS_MAX),
        }));
      }
    },
  };
}

/**
 * This computer's record, in the workspace's machine folder beside the
 * permission rules, which name this computer's paths too. In memory only
 * where no workspace is open.
 */
const answers = createMacosFolderAnswers({
  file: () =>
    hasWorkspaceConfig() ? permissionsFileIn(workspaceMachineDir()) : undefined,
});

/**
 * Set in the bash worker, which meets macOS's answers in the shell's
 * listings while the record is the main thread's.
 */
let forward:
  | ((hostPath: string, looked: "open" | "system") => void)
  | undefined;

export function setMacosFolderListedForwarder(
  next: NonNullable<typeof forward>,
): void {
  forward = next;
}

/**
 * Records what a listing of a folder, made for the person, found of
 * macOS's answer. Never waited on and never failing: the listing it follows
 * has already answered.
 */
export function noteMacosFolderListed(
  hostPath: string,
  looked: "open" | "system",
): void {
  if (forward) {
    forward(hostPath, looked);
    return;
  }
  void answers.note(hostPath, looked).catch(() => undefined);
}

/** The folders macOS has answered for on this computer, for `macosMayAsk`. */
export function macosAnsweredFolders(): Promise<ReadonlySet<string>> {
  return answers.answered();
}
