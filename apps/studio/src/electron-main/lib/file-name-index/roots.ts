import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { pinnedPlaces } from "@/shared/sidebar-places";
import {
  computerPlaces,
  macosAnsweredFolders,
  macosMayAsk,
  macosMayAskBelow,
  resolveWithoutAsking,
} from "@instrument-org/workspace/electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileNameIndex } from "./file-name-index";
import { listRepositoryFiles } from "./list-repository";
import { walkFileNames } from "./walk";

/**
 * Where the walk does not read, decided from a path alone, so deciding
 * reads nothing: `staysOut` for a folder itself, `staysOutBelow` for
 * whether any folder below one may stay out, and `readsAbove` for whether
 * a file may be opened in every folder above one, which listing a
 * repository does (`listRepositoryFiles`). The workspace's exception does
 * not reach above the workspace.
 *
 * On macOS the walk stays out of every folder whose read could raise the
 * system's prompt: a folder macOS guards with no answer on record
 * (`macosMayAsk`, over `answered`). The workspace's own folder is the one
 * exception, with everything in it: the launch read the workspace's records
 * several folders down inside it, so macOS has answered for whatever guards
 * it. `workspace` is where that folder really is, or undefined to leave the
 * exception out.
 *
 * On Windows it stays out of the home folder's AppData, where programs keep
 * their own data. Names compare whatever their case on both.
 */
export function stayOutRules({
  answered,
  home,
  platform,
  workspace,
}: {
  answered: ReadonlySet<string>;
  home: string;
  platform: NodeJS.Platform;
  workspace: string | undefined;
}): {
  readsAbove: (folder: string) => boolean;
  staysOut: (folder: string) => boolean;
  staysOutBelow: (folder: string) => boolean;
} {
  if (platform === "win32") {
    const appData = `${home.toLowerCase()}\\appdata`;
    return {
      readsAbove: () => true,
      staysOut: (folder) => isWithin(folder.toLowerCase(), appData, "\\"),
      staysOutBelow: (folder) => isWithin(appData, folder.toLowerCase(), "\\"),
    };
  }
  if (platform !== "darwin") {
    return {
      readsAbove: () => true,
      staysOut: () => false,
      staysOutBelow: () => false,
    };
  }
  const inWorkspace = (folder: string) =>
    workspace !== undefined &&
    isWithin(folder.toLowerCase(), workspace.toLowerCase(), "/");
  return {
    readsAbove: (folder) => {
      for (
        let above = path.posix.dirname(folder), at = folder;
        above !== at;
        at = above, above = path.posix.dirname(above)
      ) {
        if (!inWorkspace(above) && macosMayAsk(above, { answered, home })) {
          return false;
        }
      }
      return true;
    },
    staysOut: (folder) =>
      !inWorkspace(folder) && macosMayAsk(folder, { answered, home }),
    staysOutBelow: (folder) =>
      !inWorkspace(folder) && macosMayAskBelow(folder, { answered, home }),
  };
}

/** Whether `inner` is `outer` or inside it, both spelled alike. */
function isWithin(inner: string, outer: string, separator: string): boolean {
  const above = outer.endsWith(separator) ? outer : `${outer}${separator}`;
  return inner === outer || inner.startsWith(above);
}

/** The disk a folder is on, read from the folder alone and never from inside it. */
async function deviceOf(folder: string): Promise<number | undefined> {
  return fs.lstat(folder).then(
    (stats) => stats.dev,
    () => undefined,
  );
}

/**
 * What the app's index walks: the workspace's folder, the Instrument
 * folder, and the Files sidebar's Pinned rows as the person left them, each
 * where it really is, so a pinned link leads to its folder. The sidebar's
 * disks and cloud services are left out: a disk's top is the whole computer,
 * and listing a cloud service's folder can fetch from the network.
 *
 * On macOS a root is resolved by hand, reading no link kept where the walk
 * stays out (`resolveWithoutAsking`), and the walk keeps to the home
 * folder's disk and the disks under `/Volumes`: a disk mounted anywhere
 * else is one macOS may ask about with nothing in its path to tell.
 */
async function fileNameWalk(): Promise<Parameters<typeof walkFileNames>[0]> {
  const isMac = process.platform === "darwin";
  const places = (await computerPlaces()).pinned;
  const output = places.find((place) => place.kind === "output");
  const pinned = pinnedPlaces(
    places
      .filter((place) => place !== output)
      .map((place) => ({ path: place.path })),
    getMachinePreferences().get("sidebarPlaces"),
    (pinnedPath) => ({ path: pinnedPath }),
  );
  const rules = stayOutRules({
    answered: await macosAnsweredFolders(),
    home: os.homedir(),
    platform: process.platform,
    workspace: isMac
      ? await resolveWithoutAsking(getWorkspaceFolder(), () => true)
      : undefined,
  });
  const homeDisk = isMac ? await deviceOf(os.homedir()) : undefined;
  const roots = await Promise.all(
    [
      getWorkspaceFolder(),
      ...(output ? [output.path] : []),
      ...pinned.map((place) => place.path),
    ].map(async (spelled) => {
      if (!isMac) {
        return fs.realpath(spelled).catch(() => undefined);
      }
      const real = await resolveWithoutAsking(spelled, rules.staysOut);
      const isOnKnownDisk =
        real !== undefined &&
        (/^\/volumes\/[^/]+/i.test(real) ||
          (await deviceOf(real)) === homeDisk);
      return isOnKnownDisk ? real : undefined;
    }),
  );
  return {
    ...(isMac ? { deviceOf } : {}),
    listRepository: async (folder, timeoutMs) =>
      rules.readsAbove(folder)
        ? listRepositoryFiles(folder, { timeoutMs })
        : undefined,
    roots: roots.filter((root) => root !== undefined),
    staysOut: rules.staysOut,
    staysOutBelow: rules.staysOutBelow,
  };
}

/** The app's index of the names in the workspace and the sidebar's folders. */
export const fileNameIndex = createFileNameIndex({
  walk: async () => walkFileNames(await fileNameWalk()),
});
