/* oxlint-disable studio/no-os-words -- folder names as they are on disk, never shown */
import { type Os } from "./os-conventions";

/**
 * The folders in the home folder where reading raises macOS's prompt, or its
 * notice that the app was kept out of other apps' data: Desktop, Documents,
 * Downloads, iCloud Drive, the Music and Photos libraries and other apps' files.
 */
export const MACOS_GUARDED_HOME_FOLDERS = [
  "Desktop",
  "Documents",
  "Downloads",
  "Library",
  "Library/Containers",
  "Library/Group Containers",
  "Library/Mobile Documents",
  "Movies",
  "Music",
  "Pictures",
] as const;

/**
 * Whether reading this very folder may put macOS's prompt up: a guarded folder
 * or a disk, reached from outside it. Inside one, the question has already been
 * answered by the listing on screen.
 */
export function macosAsksBeforeReading(
  hostPath: string,
  { home, os }: { home: string; os: Os },
): boolean {
  return (
    os === "mac" &&
    (MACOS_GUARDED_HOME_FOLDERS.some(
      (name) => hostPath === `${home}/${name}`,
    ) ||
      /^\/Volumes\/[^/]+$/.test(hostPath))
  );
}

/**
 * Whether a file is in another app's container, where macOS may ask the person
 * to let this app into other apps' data before the system draws a thumbnail of
 * it, even of a file they dropped in, which plain reads may open.
 */
export function isInMacosAppContainer(hostPath: string): boolean {
  return /\/Library\/(?:Group )?Containers\//.test(hostPath);
}
