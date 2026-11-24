import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { MACOS_GUARDED_HOME_FOLDERS } from "@/shared/macos-guarded-folders";
import { pinnedPlaces } from "@/shared/sidebar-places";
import {
  computerPlaces,
  macosAnsweredFolders,
} from "@instrument-org/workspace/electron";
import os from "node:os";

import { createFileNameIndex } from "./file-name-index";
import { walkFileNames } from "./walk";

/** The Mac's data volume, which shows its folders a second time under this path. */
const MAC_DATA_VOLUME = "/system/volumes/data";

/**
 * Whether the walk stays out of `folder`, by its path alone, so deciding
 * reads nothing.
 *
 * On macOS that is every folder where a first read raises the system's
 * prompt (the guarded folders of the home folder, and a disk under
 * `/Volumes`) unless it is in one of `answered`: the folders macOS has
 * already answered for, where a read raises nothing whichever way it
 * answered. The home folder's Library, where programs keep their own data,
 * is among the guarded ones. On Windows it is the home folder's AppData,
 * for the same reason. Names compare whatever their case on both.
 */
export function walkStaysOut(
  folder: string,
  {
    answered,
    home,
    platform,
  }: { answered: readonly string[]; home: string; platform: NodeJS.Platform },
): boolean {
  if (platform === "win32") {
    return isWithin(
      folder.toLowerCase(),
      `${home.toLowerCase()}\\appdata`,
      "\\",
    );
  }
  if (platform !== "darwin") {
    return false;
  }
  const spelled = folder.toLowerCase();
  const at = isWithin(spelled, MAC_DATA_VOLUME, "/")
    ? spelled.slice(MAC_DATA_VOLUME.length) || "/"
    : spelled;
  if (answered.some((open) => isWithin(at, open.toLowerCase(), "/"))) {
    return false;
  }
  return (
    /^\/volumes\/[^/]+/.test(at) ||
    MACOS_GUARDED_HOME_FOLDERS.some((name) =>
      isWithin(at, `${home}/${name}`.toLowerCase(), "/"),
    )
  );
}

/** Whether `inner` is `outer` or inside it, both spelled alike. */
function isWithin(inner: string, outer: string, separator: string): boolean {
  return inner === outer || inner.startsWith(`${outer}${separator}`);
}

/**
 * Where the index looks: the workspace's folder, the Instrument folder, and
 * the Files sidebar's Pinned rows as the person left them. The sidebar's
 * disks and cloud services are left out: a disk's top is the whole computer,
 * and listing a cloud service's folder can fetch from the network.
 *
 * The workspace's folder counts as answered for on macOS, since the launch
 * read the workspace's own records there.
 */
async function fileNameRoots() {
  const workspace = getWorkspaceFolder();
  const places = (await computerPlaces()).pinned;
  const output = places.find((place) => place.kind === "output");
  const pinned = pinnedPlaces(
    places
      .filter((place) => place !== output)
      .map((place) => ({ path: place.path })),
    getMachinePreferences().get("sidebarPlaces"),
    (path) => ({ path }),
  );
  const facts = {
    answered: [workspace, ...macosAnsweredFolders()],
    home: os.homedir(),
    platform: process.platform,
  };
  return {
    roots: [
      workspace,
      ...(output ? [output.path] : []),
      ...pinned.map((place) => place.path),
    ],
    staysOut: (folder: string) => walkStaysOut(folder, facts),
  };
}

/** The app's index of the names in the workspace and the sidebar's folders. */
export const fileNameIndex = createFileNameIndex({
  walk: async () => walkFileNames(await fileNameRoots()),
});
