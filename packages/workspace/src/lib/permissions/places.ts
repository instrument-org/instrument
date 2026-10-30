import {
  APP_BUNDLE_ID,
  APP_NAME,
  APP_UPDATER_CACHE_DIR_NAME,
  APP_VELOPACK_ID,
} from "@instrument-org/shared";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { SYSTEM_DRIVE } from "../disk-root";
import { iCloudDrivePath } from "../chat/icloud-drive";
import { outputFolderPath } from "../chat/output-folder";

/**
 * What a rule says about a folder: the agent may open and change what is in
 * it, asks the person first, or keeps out of it.
 */
export const LevelSchema = z.enum(["allow", "ask", "never"]);
export type Level = z.output<typeof LevelSchema>;

/**
 * The places every folder on the computer starts in, and the rule each starts
 * with until the person changes it. Nothing finer is built in: a folder the
 * person or a chat names gets its own rule at its own depth.
 */
export const PlaceIdSchema = z.enum([
  "output",
  "desktop",
  "documents",
  "downloads",
  "icloud",
  "drives",
  "appFiles",
  "photos",
  "mediaLibraries",
  "passwords",
]);
export type PlaceId = z.output<typeof PlaceIdSchema>;

export const PLACE_DEFAULTS = {
  appFiles: "ask",
  desktop: "ask",
  documents: "ask",
  downloads: "ask",
  drives: "ask",
  icloud: "ask",
  mediaLibraries: "ask",
  output: "allow",
  passwords: "ask",
  photos: "ask",
} as const satisfies Record<PlaceId, Level>;

/**
 * Places in the home folder where command-line tools keep the person's
 * sign-ins: SSH and GPG keys, cloud and CLI credentials, password stores.
 * The passwords place's level holds them, Ask first by default, so one card
 * lets `ssh` or `aws` work in a chat. Each asks for itself, whatever folder
 * in it the agent ran into, and "Use folders without asking" leaves them
 * asking: the switch is for folders of work.
 *
 * This is the list that asks, rather than a list of what may be read: every
 * other hidden folder in the home folder is read without a card, since a
 * person cannot say whether a chat should reach `.cache` or `.claude` and
 * being asked teaches them to say yes to everything. So a folder belongs
 * here when a program keeps a sign-in in it under a name people know.
 *
 * `~/.npmrc` and `~/.gitconfig` are left out: pnpm and uv read them for
 * registry and proxy settings, and git's own env already ignores the config.
 */
const SIGN_IN_PLACES = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".kube",
  ".docker/config.json",
  ".netrc",
  ".git-credentials",
  ".config/gh",
  ".config/op",
  ".password-store",
  // The same thing under a build tool's or a registry's own name.
  ".m2/settings.xml",
  ".gradle/gradle.properties",
  ".pypirc",
  ".cargo/credentials.toml",
  ".gem/credentials",
  ".terraform.d/credentials.tfrc.json",
  ".cache/huggingface/token",
  ".cache/huggingface/stored_tokens",
];

/**
 * Places that hold every sign-in the person has at once: the Keychain,
 * cookies, browser profiles and 1Password's own data. They stay closed
 * unless the passwords place is set to Allowed, with no card to ask: no one
 * job needs a whole browser's sessions.
 */
const PASSWORD_PLACES = [
  "Library/Keychains",
  "Library/Cookies",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc",
  "Library/Application Support/Firefox",
  "Library/Application Support/Chromium",
  "Library/Application Support/Vivaldi",
  "Library/Application Support/com.operasoftware.Opera",
  "Library/Safari",
  "Library/Containers/com.apple.Safari",
  "Library/Group Containers/2BUA8C4S2C.com.1password",
  // The browsers' caches, which hold the pages the person visited, so they
  // stay closed with the profiles while the rest of the caches are open.
  "Library/Caches/Google/Chrome",
  "Library/Caches/com.apple.Safari",
  "Library/Caches/Firefox",
  "Library/Caches/BraveSoftware",
  "Library/Caches/Microsoft Edge",
  "Library/Caches/Arc",
  "Library/Caches/company.thebrowser.Browser",
  "Library/Caches/Chromium",
  "Library/Caches/Vivaldi",
  "Library/Caches/com.operasoftware.Opera",
  // Linux browsers keep their profiles under ~/.config and ~/.mozilla.
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware",
  ".config/microsoft-edge",
  ".config/vivaldi",
  ".mozilla",
  ".cache/google-chrome",
  ".cache/chromium",
  ".cache/BraveSoftware",
  ".cache/microsoft-edge",
  ".cache/vivaldi",
  ".cache/mozilla",
  // The same browsers installed as a snap (Ubuntu's Firefox) or a Flatpak.
  "snap/firefox",
  "snap/chromium",
  "snap/brave",
  "snap/opera",
  ".var/app/org.mozilla.firefox",
  ".var/app/org.chromium.Chromium",
  ".var/app/com.google.Chrome",
  ".var/app/com.brave.Browser",
  ".var/app/com.microsoft.Edge",
  ".var/app/com.vivaldi.Vivaldi",
  ".var/app/io.github.ungoogled_software.ungoogled_chromium",
  // Windows browsers, under AppData.
  "AppData/Local/Google/Chrome/User Data",
  "AppData/Local/Microsoft/Edge/User Data",
  "AppData/Local/BraveSoftware/Brave-Browser/User Data",
  "AppData/Roaming/Mozilla/Firefox",
  "AppData/Local/Vivaldi/User Data",
  "AppData/Roaming/Opera Software",
  // Windows' own stores of saved sign-ins and the keys that unlock them.
  "AppData/Local/Microsoft/Credentials",
  "AppData/Roaming/Microsoft/Credentials",
  "AppData/Roaming/Microsoft/Protect",
  "AppData/Local/Microsoft/Vault",
  "AppData/Roaming/Microsoft/Vault",
];

/**
 * Folders under `AppData` on Windows whose names alone say what the person
 * has been doing: the files they opened lately (and each app's jump list in
 * there), Office's recent files, their PowerShell history, the web cache and
 * history, and Windows' activity history. No job needs them, and while the
 * app-files place asks first the sandbox can show the names in `AppData`
 * (`windows-sandbox.md`), so they stay Not allowed until the place is
 * Allowed.
 */
const WINDOWS_ACTIVITY_PLACES = [
  "AppData/Roaming/Microsoft/Windows/Recent",
  "AppData/Roaming/Microsoft/Office/Recent",
  "AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine",
  "AppData/Local/Microsoft/Windows/History",
  "AppData/Local/Microsoft/Windows/INetCache",
  "AppData/Local/Microsoft/Windows/WebCache",
  "AppData/Local/ConnectedDevicesPlatform",
];

/**
 * What runs on its own later: login items, launch agents, and the files a
 * shell reads when it starts. A change to one runs whatever it says the next
 * time the person logs in or opens a terminal, outside every sandbox, so
 * these are closed to the agent whatever Settings says, with no card to ask.
 */
const STARTUP_PLACES = [
  "Library/LaunchAgents",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".profile",
  ".config/fish/config.fish",
  ".config/fish/conf.d",
  // A function fish loads the first time its name is typed.
  ".config/fish/functions",
  ".config/autostart",
  // User units systemd starts, and the environment it gives every one.
  ".config/systemd/user",
  ".config/environment.d",
  "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup",
  // What PowerShell reads when a session starts, which is Windows' answer to
  // `.zshrc` and sits under Documents, a place a card can open: without these
  // a person who allows Documents has allowed a file that runs at their next
  // prompt. Both editions, since a machine can have either.
  "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
  "Documents/PowerShell/profile.ps1",
  "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
  "Documents/WindowsPowerShell/profile.ps1",
  // OneDrive moves Documents under it, so the same files live here too.
  "OneDrive/Documents/PowerShell",
  "OneDrive/Documents/WindowsPowerShell",
];

/**
 * Where Velopack installs the app on Windows: `Update.exe`, the launcher stub
 * the shortcuts start, the downloaded `packages\`, and the app in `current\`,
 * all run outside every sandbox. This build's own folder, and the shipping
 * app's when this is a preview, since a preview's chat could otherwise change
 * what the shipping app runs. Readable by every chat, as the agent's `node`
 * and the bundled tools run from `current\`, and changed by none: a person's
 * rule inside it opens nothing there.
 */
export function appInstallFolders(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "win32") {
    return [];
  }
  return [...new Set([APP_VELOPACK_ID, APP_NAME])].map((id) =>
    path.join(home, "AppData", "Local", id),
  );
}

/**
 * Folders under `AppData` on Windows that programs keep for themselves, and
 * people keep no files in, readable by every chat so the app-files place
 * does not ask about them: `Programs`, where per-user installs go (Python
 * from python.org, VS Code, Cursor), which a program on the PATH reads to
 * run, and the app's own install (`appInstallFolders`). A person's rule
 * deeper in `Programs` still decides there.
 */
export function windowsProgramFolders(home = os.homedir()): string[] {
  return [
    path.join(home, "AppData", "Local", "Programs"),
    ...appInstallFolders(home, "win32"),
  ];
}

/**
 * Where the app's updater keeps a download before installing it, in the
 * caches the app-files place opens: electron-updater's folder, on a Mac the
 * folder ShipIt stages the new build in and the app's own web cache, and on
 * Windows the Velopack install's `packages\`, whose package Velopack applies
 * without checking it again when it finds one already there.
 * An install runs outside every sandbox (on Linux as root, through dpkg), so
 * these are the app's own data, closed to every chat.
 */
export function appUpdateCaches(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") {
    const caches = path.join(home, "Library", "Caches");
    return [
      path.join(caches, APP_UPDATER_CACHE_DIR_NAME),
      path.join(caches, `${APP_BUNDLE_ID}.ShipIt`),
      path.join(caches, APP_BUNDLE_ID),
    ];
  }
  if (platform === "linux") {
    return [path.join(home, ".cache", APP_UPDATER_CACHE_DIR_NAME)];
  }
  return appInstallFolders(home, platform).map((root) =>
    path.join(root, "packages"),
  );
}

/** The startup places as paths in `home`. */
export function startupPaths(home = os.homedir()): string[] {
  return STARTUP_PLACES.map((place) => path.join(home, place));
}

/**
 * Folders in the app-files place that hold a folder per app, so a card for
 * a file in one names that app's folder ("Code" in `Application Support`)
 * rather than the folder every app shares.
 */
const APP_FOLDER_PARENTS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    "Library/Application Support",
    "Library/Containers",
    "Library/Group Containers",
    "Library/Logs",
  ],
  win32: [
    "AppData/Roaming",
    "AppData/Local",
    "AppData/LocalLow",
    "AppData/Local/Packages",
  ],
};

/** The folders of {@link APP_FOLDER_PARENTS} as paths in `home`. */
export function appFolderParents(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  return (APP_FOLDER_PARENTS[platform] ?? []).map((parent) =>
    path.join(home, parent),
  );
}

/**
 * A place as paths on this computer. `closedUnlessAllowed` are paths in the
 * place that stay Not allowed while the place asks first, and
 * `openUnlessClosed` paths open while it asks first and closed only when it
 * is Not allowed. A `listed` place shows programs and the shell the names,
 * sizes and dates in it while it asks first, but in its `unlisted` folders;
 * opening or changing a file in it still asks.
 */
export interface PlacePaths {
  closedUnlessAllowed?: string[];
  id: PlaceId;
  listed?: true;
  openUnlessClosed?: string[];
  paths: string[];
  unlisted?: string[];
}

/** Every built-in place this platform has, as paths in `home`. */
export function placePaths(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): PlacePaths[] {
  const inHome = (...names: string[]) =>
    names.map((name) => path.join(home, name));
  const mac = platform === "darwin";
  // The fixed places are spelled from this account's home; carried over to
  // `home` so a check against another home folder lines up.
  const inOwnHome = (placePath: string) =>
    path.join(home, path.relative(os.homedir(), placePath));
  const places: PlacePaths[] = [
    { id: "output", paths: [inOwnHome(outputFolderPath())] },
    { id: "desktop", paths: inHome("Desktop") },
    { id: "documents", paths: inHome("Documents") },
    { id: "downloads", paths: inHome("Downloads") },
    {
      closedUnlessAllowed: inHome(...PASSWORD_PLACES),
      id: "passwords",
      paths: inHome(...SIGN_IN_PLACES),
    },
  ];
  if (mac) {
    places.push(
      { id: "icloud", paths: [inOwnHome(iCloudDrivePath())] },
      { id: "drives", paths: ["/Volumes"] },
      // Listed, so a program sees what is in it without opening a file. But
      // not the apps' containers: macOS asks the person before a program
      // looks into another app's container, in a dialog the program waits
      // on. Caches is open, since what is in it is made again from
      // something else, but for the browsers', closed with their profiles,
      // and so is `~/.cache`, where command-line tools keep theirs on a Mac
      // too (Hugging Face's downloads, Whisper's models).
      {
        id: "appFiles",
        listed: true,
        openUnlessClosed: inHome("Library/Caches", ".cache"),
        paths: inHome("Library"),
        unlisted: inHome("Library/Containers", "Library/Group Containers"),
      },
      // The Photos, Music and TV libraries are folders macOS asks the
      // person about before any program reads them, in a dialog the program
      // waits on. Closed here, the sandbox refuses a native walk over the
      // home folder before it reaches macOS's question. Two places, so a
      // person who keeps their own photos in the library can open just that.
      { id: "photos", paths: inHome("Pictures/Photos Library.photoslibrary") },
      {
        id: "mediaLibraries",
        paths: inHome("Music/Music", "Music/iTunes", "Movies/TV"),
      },
    );
  } else if (platform === "linux") {
    places.push(
      // The system's own /mnt, where Linux mounts a drive by hand.
      { id: "drives", paths: ["/media", "/run/media", "/mnt"] },
      // Where a Linux program keeps its settings and its data, which is what
      // `Library` is on a Mac and `AppData` on Windows. Not listed, since
      // bubblewrap cannot show a folder's names without what is in it.
      // `.cache` is open, as `Library/Caches` is on a Mac.
      {
        id: "appFiles",
        openUnlessClosed: inHome(".cache"),
        paths: inHome(".config", ".local/share"),
      },
    );
  } else {
    places.push(
      { id: "drives", paths: windowsDrives() },
      {
        closedUnlessAllowed: inHome(...WINDOWS_ACTIVITY_PLACES),
        id: "appFiles",
        listed: true,
        paths: inHome("AppData"),
      },
    );
  }
  return places;
}

/**
 * Every drive letter on this computer but the one Windows runs from, the
 * way `/Volumes` holds every disk but the startup one on a Mac. Read each
 * time the rules are built, so a drive plugged in later is covered from the
 * next command.
 */
export function windowsDrives(
  exists: (root: string) => boolean = existsSync,
  systemDrive = SYSTEM_DRIVE,
): string[] {
  const system = systemDrive.slice(0, 1).toUpperCase();
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    .split("")
    .filter((letter) => letter !== system)
    .map((letter) => `${letter}:\\`)
    .filter((root) => exists(root));
}
