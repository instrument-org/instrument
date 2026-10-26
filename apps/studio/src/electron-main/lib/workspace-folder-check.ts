import { HOME_DATA_FOLDER_NAMES } from "@instrument-org/shared";
import { placePaths, startupPaths } from "@instrument-org/workspace/electron";
import os from "node:os";
import path from "node:path";

import {
  type FolderRefusal,
  type FolderWarning,
} from "../../shared/workspace-folder-refusal";
import { pathKey } from "./path-identity";

/**
 * Whether a folder can be an Instrument folder, for every way one reaches the
 * app: picked to move the workspace to, picked to open, or found in the
 * registry at launch. Refused, with no way past, are only the places the app
 * would break: the home folder (whose `.instrument` is the installed app's
 * own `~/.instrument`), the app's own files, every flavor's own data folder
 * in the home folder (`HOME_DATA_FOLDER_NAMES`), and another workspace.
 * Every other
 * place whose contents are more than the person's own work, which every chat
 * may change from the workspace's top level, is a warning they can go past,
 * since a refusal that is wrong strands them.
 *
 * `folderConcern` is pure, so it answers for any of the three systems on any
 * of them; `folderConcernHere` feeds it this computer's facts with every path
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
  /** Where other programs keep sign-ins or what runs at login. */
  signInDirs: string[];
  /** Windows' system drive (`C:`); ignored elsewhere. */
  systemDrive?: string;
  /** The folders the system empties on its own (`systemTemporaryDirs`). */
  temporaryDirs: string[];
  /** Electron's userData. */
  userDataDir: string;
}

/** A place no workspace can be, or one the person is warned about before picking it. */
export type FolderConcern =
  | { kind: "refused"; reason: FolderRefusal }
  | { kind: "warning"; reason: FolderWarning };

/** Folders the system keeps for itself, warned of at or inside. */
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
 * Where apps keep their own settings and data in the home folder, warned of
 * at or inside, but for the folders inside them that sync the person's own files
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
 * Folders in the home folder that have the person's other files in them,
 * warned of themselves; a folder inside one is the person's to pick.
 */
const PERSONAL_FOLDERS: Record<FolderPlatform, string[][]> = {
  darwin: [
    ["Desktop"],
    ["Documents"],
    ["Downloads"],
    // oxlint-disable-next-line studio/no-os-words -- a folder name, never shown
    ["Library", "Mobile Documents", "com~apple~CloudDocs"],
  ],
  linux: [["Desktop"], ["Documents"], ["Downloads"]],
  win32: [["Desktop"], ["Documents"], ["Downloads"]],
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

/**
 * What's wrong with `folder` as an Instrument folder: a place it can never
 * be, a place the person is warned about and can still pick, or undefined
 * when nothing is.
 */
export function folderConcern(
  folder: string,
  facts: FolderFacts,
): FolderConcern | undefined {
  const { home, platform } = facts;
  const { key, paths, within } = spelling(platform);
  const target = key(folder);
  const refused = (reason: FolderRefusal) => ({
    kind: "refused" as const,
    reason,
  });
  const warned = (reason: FolderWarning) => ({
    kind: "warning" as const,
    reason,
  });

  if (target === key(home)) {
    return refused("home");
  }
  if (
    within(folder, facts.userDataDir) ||
    within(folder, facts.installDir) ||
    HOME_DATA_FOLDER_NAMES.some((name) =>
      within(folder, paths.join(home, name)),
    )
  ) {
    return refused("own-data");
  }
  if (
    facts.otherWorkspaces.some(
      (other) => within(folder, other) || within(other, folder),
    )
  ) {
    return refused("other-workspace");
  }
  if (within(home, folder)) {
    return warned("around-home");
  }
  if (isPersonalFolder(folder, facts)) {
    return warned("personal");
  }
  if (facts.temporaryDirs.some((dir) => within(folder, dir))) {
    return warned("temporary");
  }
  if (facts.signInDirs.some((dir) => within(folder, dir))) {
    return warned("sign-ins");
  }
  if (
    SYSTEM_FOLDERS[platform](facts.systemDrive ?? "C:").some((system) =>
      within(folder, system),
    )
  ) {
    return warned("system");
  }
  if (
    paths.dirname(target) === target ||
    DISK_CONTAINERS[platform].some(([container, depth]) => {
      if (!within(folder, container)) {
        return false;
      }
      const relative = paths.relative(key(container), target);
      return relative === "" || relative.split(paths.sep).length <= depth;
    })
  ) {
    return warned("drive");
  }
  if (
    within(facts.userDataDir, folder) ||
    (paths.dirname(target) === key(home) &&
      paths.basename(target).startsWith(".")) ||
    APPS_DATA_FOLDERS[platform].some(
      ({ at, except = [] }) =>
        within(folder, paths.join(home, ...at)) &&
        !except.some((names) => {
          const synced = paths.join(home, ...names);
          return within(folder, synced) && key(folder) !== key(synced);
        }),
    )
  ) {
    return warned("apps-data");
  }
  return undefined;
}

function isPersonalFolder(
  folder: string,
  { home, platform }: Pick<FolderFacts, "home" | "platform">,
) {
  const { key, paths } = spelling(platform);
  return PERSONAL_FOLDERS[platform].some(
    (names) => key(folder) === key(paths.join(home, ...names)),
  );
}

/**
 * How `platform` spells and compares paths: its separators, case folded
 * where its disks ignore case, and whether one folder is at or inside another.
 */
function spelling(platform: FolderPlatform) {
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
  return { key, paths, within };
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
 * `folderConcern` for this computer: links and junctions resolved where the
 * folders exist, and case folded where their volume ignores it.
 */
export function folderConcernHere({
  folder,
  otherWorkspaces,
  temporaryDirs = systemTemporaryDirs(),
  userDataDir,
}: {
  folder: string;
  otherWorkspaces: string[];
  /** The folders the system empties on its own (`systemTemporaryDirs`). */
  temporaryDirs?: string[];
  userDataDir: string;
}): FolderConcern | undefined {
  const home = os.homedir();
  return folderConcern(pathKey(folder), {
    home: pathKey(home),
    installDir: pathKey(installDirOf(process.execPath, platformHere())),
    otherWorkspaces: otherWorkspaces.map(pathKey),
    platform: platformHere(),
    signInDirs: [
      ...placePaths(home).flatMap((place) =>
        place.id === "passwords"
          ? [...place.paths, ...(place.closedUnlessAllowed ?? [])]
          : [],
      ),
      ...startupPaths(home),
    ].map(pathKey),
    systemDrive: process.env.SystemDrive,
    temporaryDirs: temporaryDirs.map(pathKey),
    userDataDir: pathKey(userDataDir),
  });
}

/**
 * The folders the system empties on its own: this account's temporary
 * folder and, beyond Windows, the shared ones.
 */
export function systemTemporaryDirs(): string[] {
  return process.platform === "win32"
    ? [os.tmpdir()]
    : [os.tmpdir(), "/tmp", "/var/tmp"];
}

function platformHere(): FolderPlatform {
  return process.platform === "win32" || process.platform === "darwin"
    ? process.platform
    : "linux";
}
