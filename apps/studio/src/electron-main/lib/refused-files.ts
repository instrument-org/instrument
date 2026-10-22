import { getResolvedWorkspace } from "./workspace-run";
import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import {
  canonicalizeThroughMissing,
  withoutDataVolume,
  withoutTrailingDots,
} from "@instrument-org/workspace/host-path";
import {
  homeDataLayout,
  PERSON_FOLDERS_IN_DATA_DIR,
} from "@instrument-org/workspace/layout";
import { dataHome } from "@instrument-org/workspace/work-folders";
import fs from "node:fs";
import path from "node:path";

import { getUserDataDir } from "./get-workspace-folder";
import { createdWorkspacesDir, defaultWorkspacePath } from "./workspaces";

/**
 * The files the app's own ways of showing one refuse, whoever asks: the file
 * channel the person's viewers read through (`computer-files.ts`), and what a
 * local page in the in-app browser may load (`local-file-policy.ts`).
 *
 * Two kinds are refused. A workspace's records, under a `.instrument` segment
 * anywhere but in the folders there that hold the person's own files
 * ({@link isRecordPath}). And this computer's folder, Electron's userData,
 * which keeps each workspace's keys, sign-ins and Chromium profiles under
 * names nothing else marks as private, and the flavor's data folder in the
 * home folder (`~/.instrument` for the app people install); only the
 * folders in them that are the person's to view are shown, every chat's
 * work folder among them, which {@link userDataViewRule} names.
 */

/**
 * Folders a file is refused under, and folders inside them where files are
 * shown again. The deepest folder holding a file decides, and a tie refuses.
 */
export interface ViewRule {
  refused: readonly string[];
  viewable: readonly string[];
  /**
   * Viewable folders inside the home data folder, every workspace's work
   * folders: a file in one is a record only by a `.instrument` below it.
   */
  work: readonly string[];
}

/**
 * Whether names differing only in case are one file, as they are on the
 * volumes macOS and Windows make by default. Folding there keeps a path
 * spelled in another case from slipping past a refused folder.
 */
const FOLD_CASE = process.platform === "darwin" || process.platform === "win32";

/**
 * This computer's folders' rule: all of the app's data is refused, in its
 * own folder and in its home data folder, but the workspaces it keeps, the
 * default one and those made from the dev panel, the workspace this process
 * has open wherever it is, and every chat's work folder.
 */
export function userDataViewRule({
  home = dataHome(),
  userDataDir,
  workspaceDir,
}: {
  home?: string;
  userDataDir: string;
  workspaceDir: string | undefined;
}): ViewRule {
  const homeData = homeDataLayout(home);
  return {
    refused: [userDataDir, homeData.dataDir],
    viewable: [
      defaultWorkspacePath(userDataDir),
      createdWorkspacesDir(userDataDir),
      ...(workspaceDir === undefined ? [] : [workspaceDir]),
      homeData.workDir,
    ],
    work: [homeData.workDir],
  };
}

/**
 * Whether a path is one of the app's records by its names: under a
 * `.instrument` folder, matched in any case, and not in one of the folders
 * there that hold the person's own files (`PERSON_FOLDERS_IN_DATA_DIR`:
 * what they attached to a chat), each named in the app's own
 * spelling. A second `.instrument` below the first is a record
 * again, and so is a path with a step up or a step in place below it, which
 * could name a record from inside one of those folders. Separated by either
 * slash, for a path from a URL as for one on Windows, where a name ending in
 * dots or spaces (`.instrument.`) is the name without them.
 */
export function isRecordPath(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const names = hostPath.split(/[/\\]+/);
  const isPrivate = (name: string) =>
    withoutTrailingDots(name, platform).toLowerCase() === PRIVATE_FOLDER_NAME;
  const at = names.findIndex(isPrivate);
  if (at === -1) {
    return false;
  }
  const below = names.slice(at + 1).filter((name) => name !== "");
  return (
    below.some((name) => isPrivate(name) || name === "." || name === "..") ||
    !PERSON_FOLDERS_IN_DATA_DIR.some((folder) =>
      folder.every((name, index) => {
        const actual = below[index];
        return actual !== undefined && (name === "*" || name === actual);
      }),
    )
  );
}

/**
 * Whether the file an absolute path names is refused by its name alone,
 * with its steps up and in place taken first, so a viewable folder spelled
 * on the way to a refused one does not stand for it, and spelled as the
 * system opens it ({@link opened}). Where the name really leads is
 * {@link isRefusedFile}.
 */
export function isRefusedByName(
  asked: string,
  rule: ViewRule = appViewRule(),
): boolean {
  const hostPath = opened(path.resolve(asked));
  // Below a work folder only what is below it says whether it is a record,
  // since the folder itself is under `~/.instrument` in the installed app.
  const work = rule.work.find((root) => isAtOrUnder(hostPath, root));
  if (
    isRecordPath(
      work === undefined ? hostPath : hostPath.slice(opened(work).length),
    )
  ) {
    return true;
  }
  let deepest: undefined | { length: number; refused: boolean };
  for (const [roots, refused] of [
    [rule.refused, true],
    [rule.viewable, false],
  ] as const) {
    for (const root of roots) {
      if (
        isAtOrUnder(hostPath, root) &&
        (deepest === undefined ||
          root.length > deepest.length ||
          (root.length === deepest.length && refused))
      ) {
        deepest = { length: root.length, refused };
      }
    }
  }
  return deepest?.refused ?? false;
}

/**
 * Whether the file a resolved, absolute path names is refused, by its name or
 * by where the name really leads: a symlink elsewhere could otherwise point
 * into a refused folder. A file that does not exist yet is judged where it
 * would be made, through the folders above it that do, since a write makes
 * it there; a path that cannot be followed at all is refused.
 */
export async function isRefusedFile(
  hostPath: string,
  rule: ViewRule = appViewRule(),
): Promise<boolean> {
  if (isRefusedByName(hostPath, rule)) {
    return true;
  }
  let real: null | string;
  try {
    real = await fs.promises.realpath(hostPath);
  } catch {
    real = canonicalizeThroughMissing(hostPath);
  }
  return real === null || isRefusedByName(real, rule);
}

let cached: undefined | { key: string; rule: ViewRule };

/** The rule for this process's own folder and open workspace. */
function appViewRule(): ViewRule {
  const userData = getUserDataDir();
  let workspaceDir: string | undefined;
  try {
    workspaceDir = getResolvedWorkspace().path;
  } catch {
    // Not resolved yet: only the workspaces this computer's folder keeps are shown.
  }
  const key = `${userData}\0${workspaceDir ?? ""}`;
  if (cached?.key !== key) {
    cached = {
      key,
      rule: withRealPaths(
        userDataViewRule({
          userDataDir: userData,
          workspaceDir,
        }),
        userData,
      ),
    };
  }
  return cached.rule;
}

function foldCase(hostPath: string) {
  return FOLD_CASE ? hostPath.toLowerCase() : hostPath;
}

/**
 * A path as the system opens it: on macOS off the Data volume, which
 * firmlinks join to `/` and `realpath` leaves alone, and on Windows without
 * the dots and spaces that end a name.
 */
function opened(hostPath: string) {
  return withoutTrailingDots(withoutDataVolume(hostPath));
}

function isAtOrUnder(hostPath: string, root: string) {
  const folded = foldCase(hostPath);
  const foldedRoot = foldCase(opened(root));
  return folded === foldedRoot || folded.startsWith(`${foldedRoot}${path.sep}`);
}

/**
 * Each folder of the rule also as where it really is, for a file's real path
 * to be judged against: the machine folder can sit under a symlink (`/tmp` on
 * a Mac), and a real path comes back in the case the volume keeps. A folder
 * not made yet is placed where its parent machine folder really is.
 */
function withRealPaths(rule: ViewRule, machine: string): ViewRule {
  const realMachine = realpathOr(machine, machine);
  const real = (root: string) => {
    const relative = path.relative(machine, root);
    const fallback =
      relative.startsWith("..") || path.isAbsolute(relative)
        ? root
        : path.join(realMachine, relative);
    return [...new Set([root, realpathOr(root, fallback)])];
  };
  return {
    refused: rule.refused.flatMap(real),
    viewable: rule.viewable.flatMap(real),
    work: rule.work.flatMap(real),
  };
}

function realpathOr(hostPath: string, fallback: string) {
  try {
    return fs.realpathSync.native(hostPath);
  } catch {
    return fallback;
  }
}
