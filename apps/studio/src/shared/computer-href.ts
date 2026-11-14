import { defaultStringifySearch } from "@tanstack/react-router";

/**
 * The address of a file's tab: the folder view with the file open in it, by
 * where the file is on the computer. A page's file is shown as the page, and
 * `source` asks for its text instead. `tree` is the folder a file opened
 * from the Finder shows beside it: the folder the Finder was standing in.
 */
export function fileHref(
  hostPath: string,
  { source = false, tree }: { source?: boolean; tree?: string } = {},
) {
  return `/files?file=${encodeURIComponent(hostPath)}&path=&root=~${source ? "&source=true" : ""}${tree === undefined ? "" : `&tree=${encodeURIComponent(tree)}`}`;
}

/**
 * The place above every disk: This PC, the Finder's Computer, GNOME's Other
 * Locations. Stands where a root folder stands, as the recents do, and lists
 * the disks rather than a folder.
 */
export const COMPUTER_ROOT = "computer:";

/**
 * The address of a folder's tab: the folder view standing in it.
 *
 * Rooted there rather than opened under the home folder, so the columns start
 * at the folder that was handed over instead of at the walk down to it. Takes
 * the path on the Mac, which is what the view is rooted by, and every other
 * way into a folder in this window -- a place on the home page, a path typed
 * into the omnibar -- arrives at the same address. `select` names something
 * in the folder to open with selected: a file shown in its folder. `path`
 * opens a folder under the root instead, as a prefix: `Documents/`.
 *
 * Written the way the router writes a search, which quotes a value it would
 * otherwise read back as JSON, so a file named `2024` or `true` is selected
 * by its name.
 */
export function folderHref(
  hostPath: string,
  { path = "", select }: { path?: string; select?: string } = {},
) {
  return `/files${defaultStringifySearch({ path, root: hostPath, select })}`;
}

/** The query keys of a Files address that name a folder or a file by its path. */
const FILES_ADDRESS_PATHS = new Set(["file", "root", "tree"]);

/**
 * A Files address (`/files?root=<path>`) with the folder or file each of its
 * paths names put where `where` says that path is now; any other address,
 * and an address naming nothing `where` moves, as it was.
 */
export function movedFilesAddress(
  address: string,
  where: (hostPath: string) => string,
): string {
  if (!address.startsWith("/files?")) {
    return address;
  }
  const at = address.indexOf("?");
  const query = address
    .slice(at + 1)
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const key = pair.slice(0, equals);
      if (equals === -1 || !FILES_ADDRESS_PATHS.has(key)) {
        return pair;
      }
      // Written by `fileHref` with each space as `%20`, or by the router
      // (`folderHref`) as a form is, each space a `+`; written back the way
      // it was found.
      const value = pair.slice(equals + 1);
      let hostPath: string;
      try {
        hostPath = decodeURIComponent(value.replaceAll("+", " "));
      } catch {
        return pair;
      }
      const moved = where(hostPath);
      if (moved === hostPath) {
        return pair;
      }
      const encoded = encodeURIComponent(moved);
      return `${key}=${value.includes("+") ? encoded.replaceAll("%20", "+") : encoded}`;
    });
  return `${address.slice(0, at)}?${query.join("&")}`;
}
