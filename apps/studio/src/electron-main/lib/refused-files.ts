import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { machineDir as appMachineDir } from "./get-workspace-folder";
import {
  createdWorkspacesDir,
  defaultWorkspacePath,
  getResolvedWorkspace,
} from "./workspaces";

/**
 * The files the app's own ways of showing one refuse, whoever asks: the file
 * channel the person's viewers read through (`computer-files.ts`), and what a
 * local page in the in-app browser may load (`local-file-policy.ts`).
 *
 * Two kinds are refused. A workspace's records, under a `.instrument` segment
 * anywhere. And the machine folder, Electron's userData, which keeps each
 * workspace's keys, sign-ins and Chromium profiles under names nothing else
 * marks as private; only the folders in it that are the person's to view are
 * shown, which {@link machineFolderViewRule} names.
 */

/**
 * Folders a file is refused under, and folders inside them where files are
 * shown again. The deepest folder holding a file decides, and a tie refuses.
 */
export interface ViewRule {
  refused: readonly string[];
  viewable: readonly string[];
}

const PRIVATE_SEGMENT_REGEX = new RegExp(
  `(?:^|[/\\\\])${PRIVATE_FOLDER_NAME.replace(".", "\\.")}(?:[/\\\\]|$)`,
  "i",
);

/**
 * Whether names differing only in case are one file, as they are on the
 * volumes macOS and Windows make by default. Folding there keeps a path
 * spelled in another case from slipping past a refused folder.
 */
const FOLD_CASE = process.platform === "darwin" || process.platform === "win32";

/**
 * The machine folder's rule: all of it is refused, but the workspaces it
 * keeps, the default one and those made from the dev panel, and the workspace
 * this process has open wherever it is.
 */
export function machineFolderViewRule({
  machineDir,
  workspaceDir,
}: {
  machineDir: string;
  workspaceDir: string | undefined;
}): ViewRule {
  return {
    refused: [machineDir],
    viewable: [
      defaultWorkspacePath(machineDir),
      createdWorkspacesDir(machineDir),
      ...(workspaceDir === undefined ? [] : [workspaceDir]),
    ],
  };
}

/**
 * Whether the file a resolved, absolute path names is refused by its name
 * alone. Where the name really leads is {@link isRefusedFile}.
 */
export function isRefusedByName(
  hostPath: string,
  rule: ViewRule = appViewRule(),
): boolean {
  if (PRIVATE_SEGMENT_REGEX.test(hostPath)) {
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
 * into a refused folder. A file that does not exist has nothing to give, so
 * its name alone decides.
 */
export async function isRefusedFile(
  hostPath: string,
  rule: ViewRule = appViewRule(),
): Promise<boolean> {
  if (isRefusedByName(hostPath, rule)) {
    return true;
  }
  let real: string;
  try {
    real = await fs.promises.realpath(hostPath);
  } catch {
    return false;
  }
  return isRefusedByName(real, rule);
}

let cached: undefined | { key: string; rule: ViewRule };

/** The rule for this process's machine folder and open workspace. */
function appViewRule(): ViewRule {
  const machine = appMachineDir();
  let workspaceDir: string | undefined;
  try {
    workspaceDir = getResolvedWorkspace().path;
  } catch {
    // Not resolved yet: only the workspaces the machine folder keeps are shown.
  }
  const key = `${machine}\0${workspaceDir ?? ""}`;
  if (cached?.key !== key) {
    cached = {
      key,
      rule: withRealPaths(
        machineFolderViewRule({ machineDir: machine, workspaceDir }),
        machine,
      ),
    };
  }
  return cached.rule;
}

function foldCase(hostPath: string) {
  return FOLD_CASE ? hostPath.toLowerCase() : hostPath;
}

function isAtOrUnder(hostPath: string, root: string) {
  const folded = foldCase(hostPath);
  const foldedRoot = foldCase(root);
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
  };
}

function realpathOr(hostPath: string, fallback: string) {
  try {
    return fs.realpathSync.native(hostPath);
  } catch {
    return fallback;
  }
}
