/** The file holding a Mac folder's custom icon, which Finder never shows. */
export const MAC_CUSTOM_ICON = "Icon\r";

/** What a file manager or the system leaves in a folder it shows, by name, lowercased. */
const FILE_MANAGER_RECORDS = new Set([
  "desktop.ini",
  "ehthumbs.db",
  "thumbs.db",
  MAC_CUSTOM_ICON.toLowerCase(),
]);

/** A download still arriving, or a program's scratch copy, by its ending. */
const UNFINISHED = /\.(?:crdownload|download|part|tmp)$/i;

/**
 * Whether an entry in a folder is the system's or a program's rather than
 * something a person put there, by its name alone: a dotfile (`.DS_Store`,
 * AppleDouble `._*`, `.localized`), what Explorer and Finder leave behind, an
 * Office lock file (`~$Report.docx`), or a download or save still in
 * progress. Synchronous and name-only, for a folder whose every other entry
 * means something, such as a draft's.
 */
export function isSystemClutter(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~$") ||
    FILE_MANAGER_RECORDS.has(name.toLowerCase()) ||
    UNFINISHED.test(name)
  );
}
