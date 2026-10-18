import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { type FolderRefusal } from "../../shared/workspace-folder-refusal";
import { pathKey } from "./path-identity";

/**
 * Whether a folder can be an Instrument folder at all, for every way one
 * reaches the app: picked to move the workspace to, picked to open, or
 * found in the registry at launch. The places refused are the ones whose
 * contents are more than the person's own work, since the workspace's top
 * level is the folder every chat may change.
 *
 * `folderRefusal` is pure, so it answers for any of the three systems on any
 * of them; `folderRefusalHere` feeds it this computer's facts with every path
 * resolved as its volume knows it (`pathKey`).
 */

export type FolderPlatform = "darwin" | "linux" | "win32";

export interface FolderFacts {
  /** The person's home folder. */
  home: string;
  /** The folder the app runs from: its `.app` bundle on macOS, the executable's folder elsewhere. */
  installDir: string;
  /** Every other workspace this computer knows, never the one being placed. */
  otherWorkspaces: string[];
  platform: FolderPlatform;
  /** Windows' system drive (`C:`); ignored elsewhere. */
  systemDrive?: string;
  /** Electron's userData. */
  userDataDir: string;
  /** The folder is the top of a volume, by its device (`isVolumeRoot`). */
  volumeRoot?: boolean;
}

/** Folders the system keeps for itself, refused at or inside. */
const SYSTEM_FOLDERS: Record<
  FolderPlatform,
  (systemDrive: string) => string[]
> = {
  darwin: () => [
    "/Applications",
    "/bin",
    "/cores",
    "/dev",
    "/etc",
    "/Library",
    "/opt",
    "/private/etc",
    "/sbin",
    "/System",
    "/usr",
  ],
  linux: () => [
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib32",
    "/lib64",
    "/libx32",
    "/opt",
    "/proc",
    "/sbin",
    "/snap",
    "/sys",
    "/usr",
    "/var",
  ],
  win32: (drive) => [
    `${drive}\\Windows`,
    `${drive}\\Program Files`,
    `${drive}\\Program Files (x86)`,
    `${drive}\\ProgramData`,
  ],
};

/**
 * Where apps keep their own settings and data in the home folder, refused at
 * or inside, but for the folders inside them that sync the person's own files
 * (iCloud Drive, and Dropbox or Google Drive through the system's cloud
 * storage), which are taken as any folder of theirs is.
 */
const APPS_DATA_FOLDERS: Record<
  FolderPlatform,
  { at: string[]; except?: string[][] }[]
> = {
  darwin: [
    {
      // oxlint-disable-next-line studio/no-os-words -- a folder name, never shown
      at: ["Library"],
      except: [
        // oxlint-disable-next-line studio/no-os-words -- a folder name, never shown
        ["Library", "CloudStorage"],
        // oxlint-disable-next-line studio/no-os-words -- a folder name, never shown
        ["Library", "Mobile Documents"],
      ],
    },
  ],
  linux: [{ at: [".cache"] }, { at: [".config"] }, { at: [".local"] }],
  // oxlint-disable-next-line studio/no-os-words -- a folder name, never shown
  win32: [{ at: ["AppData"] }],
};

/**
 * Folders that hold disks, by their depth below the container: a folder
 * there is a disk's top (`/Volumes/USB`), never a folder of the person's.
 */
const DISK_CONTAINERS: Record<FolderPlatform, [string, number][]> = {
  darwin: [["/Volumes", 1]],
  linux: [
    ["/media", 2],
    ["/mnt", 1],
    ["/run/media", 2],
  ],
  win32: [],
};

/** Why `folder` can't be an Instrument folder, or undefined when it can. */
export function folderRefusal(
  folder: string,
  facts: FolderFacts,
): FolderRefusal | undefined {
  const { home, platform } = facts;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const key = (spelled: string) => {
    const resolved = paths.resolve(spelled);
    return platform === "linux" ? resolved : resolved.toLowerCase();
  };
  const within = (inner: string, outer: string) => {
    const relative = paths.relative(key(outer), key(inner));
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${paths.sep}`) &&
        !paths.isAbsolute(relative))
    );
  };
  const target = key(folder);

  if (target === key(home)) {
    return "home";
  }
  if (within(home, folder)) {
    return "around-home";
  }
  if (
    within(folder, facts.userDataDir) ||
    within(folder, facts.installDir) ||
    within(folder, paths.join(home, PRIVATE_FOLDER_NAME))
  ) {
    return "own-data";
  }
  if (
    SYSTEM_FOLDERS[platform](facts.systemDrive ?? "C:").some((system) =>
      within(folder, system),
    )
  ) {
    return "system";
  }
  if (
    facts.volumeRoot === true ||
    paths.dirname(target) === target ||
    DISK_CONTAINERS[platform].some(([container, depth]) => {
      if (!within(folder, container)) {
        return false;
      }
      const relative = paths.relative(key(container), target);
      return relative === "" || relative.split(paths.sep).length <= depth;
    })
  ) {
    return "drive";
  }
  if (
    APPS_DATA_FOLDERS[platform].some(
      ({ at, except = [] }) =>
        within(folder, paths.join(home, ...at)) &&
        !except.some((names) => {
          const synced = paths.join(home, ...names);
          return within(folder, synced) && key(folder) !== key(synced);
        }),
    )
  ) {
    return "apps-data";
  }
  if (within(facts.userDataDir, folder)) {
    return "own-data";
  }
  if (
    facts.otherWorkspaces.some(
      (other) => within(folder, other) || within(other, folder),
    )
  ) {
    return "other-workspace";
  }
  return undefined;
}

/**
 * The folder the app runs from, by the program it runs: the outermost `.app` bundle
 * around it on macOS, the program's own folder elsewhere.
 */
export function installDirOf(
  executable: string,
  platform: FolderPlatform,
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "darwin") {
    const parts = executable.split(paths.sep);
    const bundle = parts.findIndex((part) => part.endsWith(".app"));
    if (bundle > 0) {
      return parts.slice(0, bundle + 1).join(paths.sep);
    }
  }
  return paths.dirname(executable);
}

/**
 * `folderRefusal` for this computer: links and junctions resolved where the
 * folders exist, and case folded where their volume ignores it.
 */
export function folderRefusalHere({
  folder,
  otherWorkspaces,
  userDataDir,
}: {
  folder: string;
  otherWorkspaces: string[];
  userDataDir: string;
}): FolderRefusal | undefined {
  const platform =
    process.platform === "win32" || process.platform === "darwin"
      ? process.platform
      : "linux";
  return folderRefusal(pathKey(folder), {
    home: pathKey(os.homedir()),
    installDir: pathKey(installDirOf(process.execPath, platform)),
    otherWorkspaces: otherWorkspaces.map(pathKey),
    platform,
    systemDrive: process.env.SystemDrive,
    userDataDir: pathKey(userDataDir),
    volumeRoot: isVolumeRoot(folder),
  });
}

/** The top of a disk: a folder on another device than the one holding it. */
function isVolumeRoot(dir: string) {
  const parent = path.dirname(dir);
  if (parent === dir) {
    return true;
  }
  try {
    return fs.statSync(dir).dev !== fs.statSync(parent).dev;
  } catch {
    return false;
  }
}
