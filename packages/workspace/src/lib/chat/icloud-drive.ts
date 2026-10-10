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
   * iCloud Drive permission. Refused, there are no folders to show.
   */
  access: z.enum(["granted", "refused"]),
  folders: z.object({ name: z.string(), path: z.string() }).array(),
});
export type ICloudAppFolders = z.output<typeof ICloudAppFoldersSchema>;

/**
 * How long a granted answer about the app folders stands. A listing of
 * iCloud Drive is asked for again on the clock, and an app's folder arrives
 * rarely. A refusal is never kept: it comes back at once, and the next read
 * after the person allows access is the one that has to show the folders.
 */
const APP_FOLDERS_TTL_MS = 30_000;
let appFolders:
  | { answer: Promise<ICloudAppFolders>; at: number; binPath?: string }
  | undefined;

/**
 * The app folders the Finder shows at the top of iCloud Drive (Pages,
 * Obsidian, Shortcuts), each at the Documents folder in the app's own
 * container. Only the Mac helper can say which containers are shown and what
 * the app is called; without it there are none. Where the iCloud Drive
 * permission has not been answered, the helper's read is what brings up the
 * macOS prompt, and it is refused while the prompt is up.
 */
export function iCloudAppFolders(): Promise<ICloudAppFolders> {
  const binPath =
    process.platform === "darwin"
      ? getWorkspaceConfig().macHelperBinPath
      : undefined;
  if (
    appFolders &&
    appFolders.binPath === binPath &&
    Date.now() - appFolders.at < APP_FOLDERS_TTL_MS
  ) {
    return appFolders.answer;
  }
  const answer: Promise<ICloudAppFolders> =
    binPath === undefined
      ? Promise.resolve({ access: "granted", folders: [] })
      : execFileAsync(binPath, ["icloud-folders"]).then(
          ({ stdout }) => ICloudAppFoldersSchema.parse(JSON.parse(stdout)),
          (): ICloudAppFolders => ({ access: "granted", folders: [] }),
        );
  appFolders = {
    answer,
    at: Date.now(),
    ...(binPath === undefined ? {} : { binPath }),
  };
  void answer.then(({ access }) => {
    if (access === "refused" && appFolders?.answer === answer) {
      appFolders = undefined;
    }
  });
  return answer;
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
