import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { pathIsWithin } from "../path-is-within";
import { getWorkspaceConfig } from "../workspace-config";

const execFileAsync = promisify(execFile);

/** Where every app's iCloud container lives, iCloud Drive's own among them. */
export function iCloudContainersPath(): string {
  return path.join(os.homedir(), "Library", "Mobile Documents");
}

/** The folder the Finder calls iCloud Drive. */
export function iCloudDrivePath(): string {
  return path.join(iCloudContainersPath(), "com~apple~CloudDocs");
}

const ICloudAppFoldersSchema = z.object({
  /**
   * Whether macOS let this app read the apps' containers, which takes the
   * iCloud Drive permission. Refused, `folders` are the ones the installed
   * apps declare, which can be named but not opened.
   */
  access: z.enum(["granted", "refused"]),
  folders: z.object({ name: z.string(), path: z.string() }).array(),
});
export type ICloudAppFolders = z.output<typeof ICloudAppFoldersSchema>;

/**
 * How long one answer about the app folders stands. A listing of iCloud
 * Drive is asked for again on the clock, and an app's folder arrives rarely.
 */
const APP_FOLDERS_TTL_MS = 30_000;
let appFolders:
  | { answer: Promise<ICloudAppFolders>; at: number; binPath?: string }
  | undefined;

/**
 * Longer than macOS takes to refuse outright, and shorter than anyone takes
 * to read its prompt and answer it.
 */
const PROMPT_SHOWN_AFTER_MS = 1500;

function helperBinPath() {
  return process.platform === "darwin"
    ? getWorkspaceConfig().macHelperBinPath
    : undefined;
}

/** Asks the Mac helper, which on the first read of a container is what brings up the macOS prompt. */
function askHelper(binPath: string | undefined): Promise<ICloudAppFolders> {
  return binPath === undefined
    ? Promise.resolve({ access: "granted", folders: [] })
    : execFileAsync(binPath, ["icloud-folders"]).then(
        ({ stdout }) => ICloudAppFoldersSchema.parse(JSON.parse(stdout)),
        (): ICloudAppFolders => ({ access: "granted", folders: [] }),
      );
}

/**
 * The app folders the Finder shows at the top of iCloud Drive (Pages,
 * Obsidian, Shortcuts), each at the Documents folder in the app's own
 * container. Only the Mac helper can say which containers are shown and what
 * the app is called; without it there are none.
 */
export function iCloudAppFolders(): Promise<ICloudAppFolders> {
  const binPath = helperBinPath();
  if (
    appFolders &&
    appFolders.binPath === binPath &&
    Date.now() - appFolders.at < APP_FOLDERS_TTL_MS
  ) {
    return appFolders.answer;
  }
  const answer = askHelper(binPath);
  appFolders = {
    answer,
    at: Date.now(),
    ...(binPath === undefined ? {} : { binPath }),
  };
  return answer;
}

/**
 * Reads the apps' containers again, now, for a person who pressed Allow
 * access. Where the permission has not been decided, macOS asks, and the
 * read waits on the answer; where it was turned down, macOS refuses at once
 * and never asks again, which is how a refusal that comes back quickly says
 * the switch in System Settings is the only way left.
 */
export async function askICloudAccess(): Promise<{
  granted: boolean;
  prompted: boolean;
}> {
  const binPath = helperBinPath();
  const started = Date.now();
  const answer = askHelper(binPath);
  appFolders = {
    answer,
    at: started,
    ...(binPath === undefined ? {} : { binPath }),
  };
  const { access } = await answer;
  return {
    granted: access === "granted",
    prompted: Date.now() - started > PROMPT_SHOWN_AFTER_MS,
  };
}

/**
 * The folder on disk a path under iCloud Drive names. An app folder is shown
 * at the top of iCloud Drive by its app's name but lives in the app's own
 * container, so `iCloud Drive/Obsidian/Vault` is read from that container's
 * Documents folder. A name iCloud Drive itself holds wins, as it does in the
 * Finder; any other path is itself.
 */
export async function resolveICloudPath(
  hostPath: string,
  isPresent: (folder: string) => Promise<boolean>,
): Promise<string> {
  const drive = iCloudDrivePath();
  if (process.platform !== "darwin" || !pathIsWithin(hostPath, drive)) {
    return hostPath;
  }
  const [first, ...rest] = path.relative(drive, hostPath).split(path.sep);
  if (!first || (await isPresent(path.join(drive, first)))) {
    return hostPath;
  }
  const app = (await iCloudAppFolders()).folders.find(
    (folder) => folder.name === first,
  );
  return app ? path.join(app.path, ...rest) : hostPath;
}
