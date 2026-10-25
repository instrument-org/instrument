/* oxlint-disable studio/no-os-words -- folder names as they are on disk, never shown */
import { type Os } from "./os-conventions";

/**
 * The folders Files never trashes, renames, duplicates or moves: the disk's
 * top, the system's own folders, the home folder and the folders the system
 * makes in it, and where cloud drives and disks are attached. Some the
 * system would refuse anyway, but the rest it would let go, and a press
 * that lands somewhere the person did not mean is one of the whole home
 * folder. What is inside them is the person's to change, but for the system's
 * own folders, where everything is the system's.
 *
 * Pure, so it answers for any system on any system: `home` is the home
 * folder in that system's spelling.
 */
export function isProtectedFolder(
  hostPath: string,
  facts: { home: string; os: Os },
): boolean {
  const { home, os } = facts;
  const windows = os === "windows";
  const separator = windows ? "\\" : "/";
  const at = normalized(hostPath, os);
  // The Mac's data volume shows the same folders again under its own path.
  const onData = os === "mac" && /^\/system\/volumes\/data(\/.*)?$/.exec(at);
  if (onData) {
    return onData[1] === undefined || isProtectedFolder(onData[1], facts);
  }
  const join = (...parts: string[]) => parts.join(separator);
  const homeKey = normalized(home, os);
  const fixed = [...EXACT[os], ...HOME[os].map((name) => join(home, name))];
  if (at === homeKey || fixed.some((path) => normalized(path, os) === at)) {
    return true;
  }
  // OneDrive names a work account's folder for the organization.
  if (
    windows &&
    at.startsWith(`${homeKey}\\onedrive - `) &&
    !at.slice(homeKey.length + 1).includes("\\")
  ) {
    return true;
  }
  // Windows' own folders are on whichever drive it was installed on.
  const onDrive = windows ? at.replace(/^[a-z]:/, "") : at;
  if (
    windows &&
    WINDOWS_ANY_DRIVE.some((path) => path.toLowerCase() === onDrive)
  ) {
    return true;
  }
  if (
    INSIDE[os].some((root) => {
      const rootKey = normalized(root, os);
      return (
        onDrive === rootKey || onDrive.startsWith(`${rootKey}${separator}`)
      );
    })
  ) {
    return true;
  }
  // A drive's top on Windows, and each place a disk or a cloud drive is
  // attached: its folder is the whole of it.
  if (windows) {
    return /^[a-z]:\\$/.test(at) || /^\\\\[^\\]+\\[^\\]+$/.test(at);
  }
  return ATTACHED[os].some(({ at: parent, depth }) => {
    const parentKey = normalized(
      parent.startsWith("~") ? home + parent.slice(1) : parent,
      os,
    );
    if (!at.startsWith(`${parentKey}/`)) {
      return false;
    }
    return at.slice(parentKey.length + 1).split("/").length <= depth;
  });
}

/**
 * A path the one way it can be spelled, so a folder is known however it was
 * written: `.` and `..` walked, doubled and trailing separators gone, and on
 * Windows the long-path prefix dropped, `/` read as `\`, and the dots and
 * spaces Windows ignores at a name's end taken off. The Mac's disks and
 * Windows' compare names whatever their case, so there it is lowercased.
 */
export function normalized(hostPath: string, os: Os): string {
  if (os !== "windows") {
    const names: string[] = [];
    for (const name of hostPath.split("/")) {
      if (name === "..") {
        names.pop();
      } else if (name !== "" && name !== ".") {
        names.push(name);
      }
    }
    const path = `/${names.join("/")}`;
    return os === "mac" ? path.toLowerCase() : path;
  }
  const spelled = hostPath.replaceAll("/", "\\").replace(/^\\\\[?.]\\/, "");
  const drive = /^[a-z]:/i.exec(spelled)?.[0];
  const isShare = drive === undefined && spelled.startsWith("\\\\");
  const names: string[] = [];
  for (const raw of spelled.slice(drive?.length ?? 0).split("\\")) {
    const name = raw === "." || raw === ".." ? raw : raw.replace(/[. ]+$/, "");
    if (name === "..") {
      names.pop();
    } else if (name !== "" && name !== ".") {
      names.push(name);
    }
  }
  const lead = drive ? `${drive}\\` : isShare ? "\\\\" : "\\";
  return `${lead}${names.join("\\")}`.toLowerCase();
}

/** The folders that are protected themselves, by their whole path. */
const EXACT: Record<Os, string[]> = {
  linux: [
    "/",
    "/home",
    "/media",
    "/mnt",
    "/root",
    "/run",
    "/run/media",
    "/srv",
    "/tmp",
    "/var",
    "/var/tmp",
  ],
  mac: [
    "/",
    "/Applications",
    "/Library",
    "/Network",
    "/opt",
    "/private",
    "/private/tmp",
    "/private/var",
    "/tmp",
    "/Users",
    "/var",
    "/Volumes",
  ],
  windows: [],
};

/** Folders protected themselves on whichever drive they are, by their path past it. */
const WINDOWS_ANY_DRIVE = ["\\Users", "\\Users\\Public"];

/** The folders protected along with everything in them: the system's own. */
const INSIDE: Record<Os, string[]> = {
  linux: [
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
    "/var/lib",
    "/var/log",
  ],
  mac: [
    "/bin",
    "/cores",
    "/dev",
    "/etc",
    "/private/etc",
    "/sbin",
    "/System",
    "/usr",
  ],
  windows: [
    "\\Windows",
    "\\Program Files",
    "\\Program Files (x86)",
    "\\ProgramData",
  ],
};

/** The folders the system makes in the home folder, and the ones other programs keep their setup in. */
const HOME: Record<Os, string[]> = {
  linux: [
    ".cache",
    ".config",
    ".local",
    ".ssh",
    "Desktop",
    "Documents",
    "Downloads",
    "Music",
    "Pictures",
    "Public",
    "Templates",
    "Videos",
  ],
  mac: [
    ".config",
    ".ssh",
    "Applications",
    "Desktop",
    "Documents",
    "Downloads",
    "Library",
    "Library/CloudStorage",
    "Library/Mobile Documents",
    "Library/Mobile Documents/com~apple~CloudDocs",
    "Movies",
    "Music",
    "Pictures",
    "Public",
  ],
  windows: [
    ".ssh",
    "3D Objects",
    "AppData",
    "Contacts",
    "Desktop",
    "Documents",
    "Downloads",
    "Favorites",
    "iCloudDrive",
    "Links",
    "Music",
    "OneDrive",
    "Pictures",
    "Saved Games",
    "Searches",
    "Videos",
  ],
};

/**
 * Where disks and cloud drives are attached, and how deep: a disk under
 * `/media` is in a folder named for the account. `~` is the home folder.
 */
const ATTACHED: Record<Os, { at: string; depth: number }[]> = {
  linux: [
    { at: "/media", depth: 2 },
    { at: "/mnt", depth: 1 },
    { at: "/run/media", depth: 2 },
  ],
  mac: [
    { at: "/Volumes", depth: 1 },
    { at: "~/Library/CloudStorage", depth: 1 },
  ],
  windows: [],
};
