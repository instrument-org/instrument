/**
 * Every word and convention in the app that belongs to the operating system it
 * runs on: what the system's own tools and places are called, how a key is
 * written, which key does what in Files, and how the file manager names what
 * it makes. One table, read by the main process (menus, the folder picker, a
 * problem report, new folders and copies) and by every screen, so a screen
 * never names another system's file manager because it wrote the name itself.
 *
 * A word or a key that depends on the system is defined here and read from
 * here. The chords themselves are the shortcut tables' (`shortcuts.ts`,
 * `window-shortcuts.ts`); how their keys are written is this table's.
 */

/** An operating system Instrument runs on. */
export type Os = "linux" | "mac" | "windows";

/**
 * The system a Node or Electron platform name stands for. Anything that is
 * neither macOS nor Windows is read as Linux, the only other system
 * Instrument is built for.
 */
export function osOf(platform: string): Os {
  if (platform === "darwin") {
    return "mac";
  }
  return platform === "win32" ? "windows" : "linux";
}

/** A modifier key, by what it is for rather than what it is called. */
type Modifier = "alt" | "command" | "control" | "shift";

export interface OsConventions {
  /**
   * The folders other apps keep their own files in, as the line under that
   * place in Settings.
   */
  appFiles: string;
  /**
   * The modifier that runs the app's own commands (⌘ on a Mac, Ctrl
   * elsewhere), as the flag a key or pointer event sets for it.
   */
  commandKey: "ctrlKey" | "metaKey";
  /** The computer, the way its own file manager heads its sidebar. */
  computer: string;
  /** The kind of computer, in "Places on your Mac". */
  computerKind: string;
  /** Files' keys, where the system's file manager decides them. */
  files: {
    /**
     * The key that renames what is selected. Where it is Return, Return
     * opens what cannot be renamed; where it is F2, Enter opens.
     */
    renameKey: "Enter" | "F2";
    /** The key that moves what is selected to the trash, and whether it is held with `commandKey`. */
    trashKey: { key: "Backspace" | "Delete"; withCommandKey: boolean };
  };
  /** The system's file manager, as a row naming it in a list of apps. */
  fileManager: string;
  /**
   * The title the system's folder picker is given where its own default
   * would not say it picks a folder.
   */
  folderPickerTitle: string | undefined;
  /** The file manager in running text, after "in": "Couldn't show it in Finder". */
  inFileManager: string;
  /** What goes between keys written as text: ⇧⌘T runs together, Ctrl+Shift+T takes a plus. */
  keyJoiner: "" | "+";
  /** How each modifier is written on a key, in the shortcut guide and in tooltips. */
  modifierKeys: Record<Modifier, string>;
  /**
   * The system's own store of passwords where it is a place apart that the
   * app keeps closed, or null where there is none.
   */
  passwordStore: null | string;
  /** A look at a file without opening it, as a menu row and as the look's name. */
  quickLook: string;
  /** The menu row that selects a file or folder in the system's file manager. */
  showInFileManager: string;
  /** The computer in running text: "runs on this Mac". */
  thisComputer: string;
  /** Where a deleted file waits, in running text: "Moved it to the Trash". */
  trash: string;
}

export const OS_CONVENTIONS = {
  linux: {
    appFiles: "Hidden folders like .config",
    commandKey: "ctrlKey",
    computer: "This Computer",
    computerKind: "computer",
    // GNOME Files and Dolphin rename on F2 and open on Enter, as File
    // Explorer does.
    files: {
      renameKey: "F2",
      trashKey: { key: "Delete", withCommandKey: false },
    },
    // Which file manager a Linux desktop has varies, and "Files", GNOME's
    // name for its own, is already the name of Instrument's.
    fileManager: "File Manager",
    // The desktop portal titles a folder picker "Open File" unless told.
    folderPickerTitle: "Select Folder",
    inFileManager: "your file manager",
    keyJoiner: "+",
    modifierKeys: {
      alt: "Alt",
      command: "Super",
      control: "Ctrl",
      shift: "Shift",
    },
    passwordStore: null,
    quickLook: "Preview",
    showInFileManager: "Show in File Manager",
    thisComputer: "this computer",
    trash: "Trash",
  },
  mac: {
    appFiles: "Library and hidden folders",
    commandKey: "metaKey",
    computer: "This Mac",
    computerKind: "Mac",
    // Return renames in the Finder; ⌘⌫ is its Move to Trash.
    files: {
      renameKey: "Enter",
      trashKey: { key: "Backspace", withCommandKey: true },
    },
    fileManager: "Finder",
    folderPickerTitle: undefined,
    inFileManager: "Finder",
    keyJoiner: "",
    modifierKeys: { alt: "⌥", command: "⌘", control: "⌃", shift: "⇧" },
    passwordStore: "Keychain",
    quickLook: "Quick Look",
    showInFileManager: "Show in Finder",
    thisComputer: "this Mac",
    trash: "Trash",
  },
  windows: {
    appFiles: "AppData",
    commandKey: "ctrlKey",
    computer: "This PC",
    computerKind: "PC",
    files: {
      renameKey: "F2",
      trashKey: { key: "Delete", withCommandKey: false },
    },
    fileManager: "File Explorer",
    folderPickerTitle: undefined,
    inFileManager: "File Explorer",
    keyJoiner: "+",
    modifierKeys: {
      alt: "Alt",
      command: "Win",
      control: "Ctrl",
      shift: "Shift",
    },
    passwordStore: null,
    quickLook: "Preview",
    showInFileManager: "Show in File Explorer",
    thisComputer: "this PC",
    trash: "Recycle Bin",
  },
} as const satisfies Record<Os, OsConventions>;

/** The conventions of the system a Node or Electron platform name stands for. */
export function osConventionsFor(platform: string): OsConventions {
  return OS_CONVENTIONS[osOf(platform)];
}

/**
 * What the file manager calls the `n`th new folder in one place, counting
 * from 1: the Finder's "untitled folder 2", File Explorer's "New folder (2)",
 * GNOME Files' "Untitled Folder 2".
 */
export function newFolderName(os: Os, n: number): string {
  switch (os) {
    case "linux": {
      return n === 1 ? "Untitled Folder" : `Untitled Folder ${n}`;
    }
    case "mac": {
      return n === 1 ? "untitled folder" : `untitled folder ${n}`;
    }
    case "windows": {
      return n === 1 ? "New folder" : `New folder (${n})`;
    }
  }
}

/**
 * What the file manager calls the `n`th copy of `stem` made beside it,
 * counting from 1, before the extension goes back on: the Finder's
 * "notes copy 2", File Explorer's "notes - Copy (2)", GNOME Files'
 * "notes (copy 2)".
 */
export function copyName(os: Os, stem: string, n: number): string {
  switch (os) {
    case "linux": {
      return n === 1 ? `${stem} (copy)` : `${stem} (copy ${n})`;
    }
    case "mac": {
      return n === 1 ? `${stem} copy` : `${stem} copy ${n}`;
    }
    case "windows": {
      return n === 1 ? `${stem} - Copy` : `${stem} - Copy (${n})`;
    }
  }
}

/** What kind of disk a Windows drive letter stands for, as the system reports it. */
export type WindowsDriveKind =
  | "fixed"
  | "network"
  | "optical"
  | "ram"
  | "removable"
  | "unknown";

/**
 * A Windows drive the way File Explorer lists it: the disk's label, or what
 * Explorer calls a disk of its kind with none, then the letter, as in
 * "Local Disk (C:)". A mapped network drive is named by its share and server
 * instead. A Mac's volumes and the folders Linux mounts disks at are already
 * named by their labels, which is how the Finder and the Linux file managers
 * show them, so only Windows has a rule of its own.
 */
export function windowsDriveName({
  kind,
  label,
  letter,
  share,
}: {
  kind: WindowsDriveKind;
  label: string;
  /** The drive, as `C:`. */
  letter: string;
  /** Where a network drive leads, as `\\server\share`. */
  share?: string;
}): string {
  const named = (name: string) => `${name} (${letter})`;
  // `\\server\share\folder` is listed as "folder (\\server\share)".
  const segments = share?.replace(/\\+$/, "").split("\\") ?? [];
  if (kind === "network" && share?.startsWith("\\\\") && segments.length > 3) {
    return named(`${segments.at(-1)} (${segments.slice(0, -1).join("\\")})`);
  }
  const trimmed = label.trim();
  if (trimmed !== "") {
    return named(trimmed);
  }
  return named(
    {
      fixed: "Local Disk",
      network: "Network Drive",
      optical: "DVD Drive",
      ram: "RAM Disk",
      removable: "USB Drive",
      unknown: "Local Disk",
    }[kind],
  );
}
