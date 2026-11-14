import { computerPlaces } from "@instrument-org/workspace/electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adoptSystemSidebar } from "@/shared/sidebar-places";

import { getMachinePreferences } from "../stores/machine/preferences";
import { logger } from "@/electron-main/lib/electron-logger";
import { finderFavorites } from "./mac-native";

/**
 * The folders the system's own file manager pins to its sidebar, in its
 * order: the Finder's Favorites on a Mac, the GTK bookmarks the Linux file
 * managers share. Nothing where the system has none to read.
 */
async function systemSidebarFolders(): Promise<string[] | undefined> {
  if (process.platform === "darwin") {
    return finderFavorites();
  }
  if (process.platform === "linux") {
    const bookmarks = await fs
      .readFile(path.join(os.homedir(), ".config", "gtk-3.0", "bookmarks"), "utf8")
      .catch(() => undefined);
    return bookmarks === undefined ? [] : gtkBookmarkFolders(bookmarks);
  }
  return undefined;
}

/**
 * The local folders in a GTK bookmarks file: one `file://` address a line,
 * then an optional label. Other addresses (a server, a trash) are left out.
 */
export function gtkBookmarkFolders(bookmarks: string): string[] {
  return bookmarks.split("\n").flatMap((line) => {
    const address = line.trim().split(" ")[0];
    if (!address?.startsWith("file://")) {
      return [];
    }
    try {
      return [fileURLToPath(address)];
    } catch {
      return [];
    }
  });
}

/**
 * Gives the Files sidebar the pins the system's file manager shows, once per
 * computer, so it opens looking like the sidebar the person already knows.
 * A computer the pins could not be read on tries again at the next launch.
 */
export async function adoptSystemSidebarOnce(): Promise<void> {
  const preferences = getMachinePreferences();
  if (preferences.get("systemSidebarAdopted")) {
    return;
  }
  try {
    const system = await systemSidebarFolders();
    if (system === undefined) {
      return;
    }
    const { pinned } = await computerPlaces();
    const defaults = pinned
      .filter((place) => place.kind !== "output")
      .map((place) => place.path);
    const existing = await Promise.all(
      system.map(async (folder) =>
        (await fs.stat(folder).catch(() => undefined))?.isDirectory()
          ? folder
          : undefined,
      ),
    );
    preferences.set(
      "sidebarPlaces",
      adoptSystemSidebar(
        preferences.get("sidebarPlaces"),
        existing.filter((folder) => folder !== undefined),
        defaults,
      ),
    );
    preferences.set("systemSidebarAdopted", true);
  } catch (error) {
    logger.warn("Could not read the system's sidebar pins", error);
  }
}
