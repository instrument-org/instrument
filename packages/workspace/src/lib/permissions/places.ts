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
  // Linux browsers keep their profiles under ~/.config and ~/.mozilla.
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware",
  ".config/microsoft-edge",
  ".config/vivaldi",
  ".mozilla",
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
 * Folders under `AppData` on Windows that programs keep for themselves, and
 * people keep no files in, open to every chat as the temp folder is, so the
 * app-files place does not ask about them. `Packages` is where Windows puts
 * each packaged app's data, and the temp folder of a program the sandbox
 * holds (which uv and pip write); `Programs` is where per-user installs go
 * (Python from python.org, VS Code, Cursor), which a program on the PATH
 * reads to run. A rule deeper in either still decides there.
 */
export function windowsProgramFolders(home = os.homedir()): {
  readOnly: string[];
  readWrite: string[];
} {
  return {
    readOnly: [path.join(home, "AppData", "Local", "Programs")],
    readWrite: [path.join(home, "AppData", "Local", "Packages")],
  };
}

/** The startup places as paths in `home`. */
export function startupPaths(home = os.homedir()): string[] {
  return STARTUP_PLACES.map((place) => path.join(home, place));
}

/**
 * Names that make a folder run code when it is opened or used: a repository's
 * hooks and submodules, a git config, an editor's tasks, a folder's shell
 * setup (direnv), and the settings, commands and servers another coding agent
 * loads from it. Changing one inside a folder the person allowed would run
 * code the next time they work in it, so they are kept from changes anywhere
 * but the chat's own folder.
 */
export const DANGEROUS_NAMES = [
  ".git/hooks",
  ".gitconfig",
  // Git's other global config (`core.fsmonitor`, `core.hooksPath`).
  ".config/git/config",
  ".gitmodules",
  ".vscode",
  ".idea",
  ".envrc",
  ".mcp.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/commands",
  ".claude/agents",
  ".codex",
];

/**
 * A place as paths on this computer. `closedUnlessAllowed` are paths in the
 * place that stay Not allowed while the place asks first.
 */
export interface PlacePaths {
  closedUnlessAllowed?: string[];
  id: PlaceId;
  paths: string[];
}

/** Every built-in place this platform has, as paths in `home`. */
export function placePaths(home = os.homedir()): PlacePaths[] {
  const inHome = (...names: string[]) =>
    names.map((name) => path.join(home, name));
  const mac = process.platform === "darwin";
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
      { id: "appFiles", paths: inHome("Library") },
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
  } else if (process.platform === "linux") {
    places.push(
      // The system's own /mnt, where Linux mounts a drive by hand.
      { id: "drives", paths: ["/media", "/run/media", "/mnt"] },
      // Where a Linux program keeps its settings and its data, which is what
      // `Library` is on a Mac and `AppData` on Windows. `.cache` is left
      // out: what is in it is made again from something else.
      { id: "appFiles", paths: inHome(".config", ".local/share") },
    );
  } else {
    places.push(
      { id: "drives", paths: windowsDrives() },
      { id: "appFiles", paths: inHome("AppData") },
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
