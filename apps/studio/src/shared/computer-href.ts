import { defaultStringifySearch } from "@tanstack/react-router";

/**
 * The address of a file's tab: the folder view with the file open in it, by
 * where the file is on the computer. A page's file is shown as the page, and
 * `source` asks for its text instead. `tree` is the folder a file opened
 * from the Finder shows beside it: the folder the Finder was standing in.
 * `version` is a copy a chat kept of the file, shown over it. `page` is the
 * page a PDF opens at. `fromLink` is a file a link from outside named while
 * nothing was at it, whose page is drawn only once it is found unmarked.
 */
export function fileHref(
  hostPath: string,
  {
    fromLink = false,
    page,
    source = false,
    tree,
    version,
  }: {
    fromLink?: boolean;
    page?: number;
    source?: boolean;
    tree?: string;
    version?: string;
  } = {},
) {
  return `/files?file=${encodeURIComponent(hostPath)}&path=&root=~${fromLink ? "&fromLink=true" : ""}${source ? "&source=true" : ""}${tree === undefined ? "" : `&tree=${encodeURIComponent(tree)}`}${version === undefined ? "" : `&version=${encodeURIComponent(version)}`}${page === undefined ? "" : `&page=${page}`}`;
}

/**
 * The place above every disk: This PC, the Finder's Computer, GNOME's Other
 * Locations. Stands where a root folder stands, as the recents do, and lists
 * the disks rather than a folder.
 */
export const COMPUTER_ROOT = "computer:";

/**
 * The place that is not a folder: the files the person opened, wherever they
 * live. Stands where a root folder stands, so the browser opens on it the way
 * it opens on Home.
 */
export const RECENTS_ROOT = "recents:";

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

/**
 * Whether a path with nothing at it names a folder, read from how it is
 * written: one ending in a separator does, and so does one whose last name
 * has no extension, the way folders are named. Anything else names a file.
 */
function namesFolder(written: string): boolean {
  if (/[\\/]$/.test(written)) {
    return true;
  }
  const name = written.split(/[\\/]/).at(-1) ?? "";
  return !/^[^.].*\.[^.]+$/.test(name);
}

/**
 * The address of a tab at a path with nothing at it, which stands there and
 * says it can't find it (`NotFound`): a folder's tab or a file's, by how the
 * path is written (`namesFolder`). `fromLink` is a path a link from outside
 * named, whose file's page is drawn only once it is found unmarked.
 */
export function missingPathHref(
  hostPath: string,
  written: string,
  { fromLink = false }: { fromLink?: boolean } = {},
): string {
  return namesFolder(written)
    ? folderHref(hostPath)
    : fileHref(hostPath, { fromLink });
}
