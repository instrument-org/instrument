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
  "Library/Group Containers/2BUA8C4S2C.com.1password",
];

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
