import { APP_NAME } from "@instrument-org/shared";
import { z } from "zod";

/**
 * What's wrong with a folder as an Instrument folder, wherever one is picked,
 * opened or found at launch (`workspace-folder-check.ts`): a refusal no one
 * can go past, kept to the places the app itself would break, or a warning
 * the person can.
 */
export const FolderRefusalSchema = z.enum([
  /** The home folder itself, whose `.instrument` is the app's own `~/.instrument`. */
  "home",
  /** The app's own data, its install folder, or `~/.instrument`, at or inside. */
  "own-data",
  /** Inside another workspace this computer knows, or with one inside it. */
  "other-workspace",
]);

export type FolderRefusal = z.output<typeof FolderRefusalSchema>;

export const FolderWarningSchema = z.enum([
  /** A folder with the home folder in it: `/Users`, `C:\Users`, the disk the home folder is on. */
  "around-home",
  /** Documents, Desktop, Downloads or iCloud Drive itself, which have the person's other files in them. */
  "personal",
  /** A folder the system empties on its own, at or inside. */
  "temporary",
  /** Where other programs keep sign-ins or what runs at login, at or inside. */
  "sign-ins",
  /** The top of a disk, or the folder disks are mounted in. */
  "drive",
  /** A folder the operating system keeps for itself, at or inside. */
  "system",
  /** Where apps keep their settings and data (`~/Library`, `AppData`, `~/.config`, a hidden folder in the home folder), at or inside, or a folder around the app's own data. */
  "apps-data",
]);

export type FolderWarning = z.output<typeof FolderWarningSchema>;

/**
 * What's wrong with the folder and what to pick instead, said to the person
 * as `${why}, so ${instead}.` once they picked it, or as `${why}.` where the
 * app found it already in use.
 */
export const FOLDER_REFUSAL_COPY: Record<
  FolderRefusal,
  { instead: string; why: string }
> = {
  home: {
    instead: "pick or make a folder inside it",
    why: "Your home folder has everything in it",
  },
  "other-workspace": {
    instead: "pick a different folder",
    why: "That folder is inside another Instrument folder or has one in it",
  },
  "own-data": {
    instead: "pick a folder in your home folder instead",
    why: `${APP_NAME} keeps its own files in that folder`,
  },
};

/** The sentence for a folder the person picked. */
export function folderRefusalSentence(refusal: FolderRefusal): string {
  const { instead, why } = FOLDER_REFUSAL_COPY[refusal];
  return `${why}, so ${instead}.`;
}

/** What makes the folder a risky place, said under it where the person picks it. */
export const FOLDER_WARNING_COPY: Record<FolderWarning, string> = {
  "apps-data": "Apps keep their settings and data here.",
  "around-home": "Your home folder is inside this one.",
  drive: "This is the top of a disk.",
  personal: "This folder has lots of your other files in it.",
  "sign-ins": "Other apps keep sign-ins or startup settings here.",
  system: "Your computer keeps its system files here.",
  temporary: "Your computer may empty this folder on its own.",
};

/** The warning for a folder the person picked. */
export function folderWarningSentence(warning: FolderWarning): string {
  return FOLDER_WARNING_COPY[warning];
}
