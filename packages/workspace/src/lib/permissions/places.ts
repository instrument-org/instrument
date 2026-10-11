import os from "node:os";
import path from "node:path";
import { z } from "zod";

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
  output: "allow",
  passwords: "never",
} as const satisfies Record<PlaceId, Level>;

/**
 * Places in the home folder that hold sign-ins rather than work: keys, cloud
 * and CLI credentials, password stores, and browser profiles with their
 * cookies. Any of them is enough to act as the person somewhere else.
 *
 * `~/.npmrc` and `~/.gitconfig` are left out: pnpm and uv read them for
 * registry and proxy settings, and git's own env already ignores the config.
 */
const PASSWORD_PLACES = [
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
  ".config/autostart",
  "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup",
];

/** The startup places as paths in `home`. */
export function startupPaths(home = os.homedir()): string[] {
  return STARTUP_PLACES.map((place) => path.join(home, place));
}

/**
 * Names that make a folder run code when it is opened or used: a repository's
 * hooks, a git config, an editor's tasks. Changing one inside a folder the
 * person allowed would run code the next time they work in it, so they are
 * kept from changes anywhere but the chat's own folder.
 */
export const DANGEROUS_NAMES = [".git/hooks", ".gitconfig", ".vscode"];

/**
 * A place as paths on this computer. `homeDotEntries` stands for every
 * hidden entry directly in the home folder, which no single path covers.
 */
export interface PlacePaths {
  homeDotEntries?: true;
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
    { id: "passwords", paths: inHome(...PASSWORD_PLACES) },
  ];
  if (mac) {
    places.push(
      { id: "icloud", paths: [inOwnHome(iCloudDrivePath())] },
      { id: "drives", paths: ["/Volumes"] },
      { homeDotEntries: true, id: "appFiles", paths: inHome("Library") },
    );
  } else if (process.platform === "linux") {
    places.push(
      // The system's own /mnt, where Linux mounts a drive by hand.
      { id: "drives", paths: ["/media", "/run/media", "/mnt"] },
      { homeDotEntries: true, id: "appFiles", paths: [] },
    );
  } else {
    places.push({
      id: "appFiles",
      paths: inHome("AppData"),
    });
  }
  return places;
}
