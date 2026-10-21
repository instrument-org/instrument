import { APP_NAME } from "@instrument-org/shared";
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

import { pathIsWithin } from "../path-is-within";
import { placePaths } from "./places";

/**
 * Folders of the system's own state rather than files, which no card asks
 * for whatever their modes say.
 */
const PSEUDO_FOLDERS = ["/dev", "/proc", "/sys"];

/**
 * Whether this account could change `hostPath` at all, by the system's own
 * answer for the nearest thing on disk: its owner and modes, an access list,
 * a read-only volume. A yes cannot open a folder only an administrator may
 * change, so no card asks for one.
 *
 * Windows answers yes: there `access` sees only the read-only flag, not the
 * folder's access list. So does a drive, where a network share's server
 * decides rather than the answer this computer gives.
 */
export function accountCanWrite(hostPath: string): boolean {
  if (process.platform === "win32") {
    return true;
  }
  if (PSEUDO_FOLDERS.some((folder) => pathIsWithin(hostPath, folder))) {
    return false;
  }
  const drives = placePaths().find((place) => place.id === "drives");
  if (drives?.paths.some((drive) => pathIsWithin(hostPath, drive))) {
    return true;
  }
  let nearest = hostPath;
  while (!existsSync(nearest) && nearest !== path.dirname(nearest)) {
    nearest = path.dirname(nearest);
  }
  try {
    accessSync(nearest, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the agent reads about a path its own lock or owner refused, in a
 * folder the app can read: nothing the person allows in the app opens it.
 */
export function lockedNote(shown: string): string {
  return `${shown} is locked, or owned by another account, so this account can't open or change it that way. Nothing the person allows in ${APP_NAME} changes that: work around it, or tell them what you needed it for.`;
}

/** What the agent reads about a path this account cannot change. */
export function systemOwnedNote(shown: string): string {
  return `${shown} belongs to the system, and only an administrator can change it. Write what you need somewhere you can, or tell the person what you needed it for.`;
}
