import { APP_PROTOCOL } from "@instrument-org/shared";

/**
 * Where the directory's bundled icons are served (`directory-icons.ts` in the
 * main process). A service's mark, like its site's favicon, so an icon from
 * here is drawn on the same plate a favicon is, where an app's own icon or its
 * Mac app's carries its own background and is drawn whole, corners cut to the
 * plate's.
 */
export const DIRECTORY_ICON_HOST = "directory-icon";

export function directoryIconUrl(fileName: string): string {
  return `${APP_PROTOCOL}://${DIRECTORY_ICON_HOST}/${fileName}`;
}

/** True for an icon that is a service's mark from the directory. */
export function isDirectoryIconUrl(url: string): boolean {
  return url.startsWith(`${APP_PROTOCOL}://${DIRECTORY_ICON_HOST}/`);
}
