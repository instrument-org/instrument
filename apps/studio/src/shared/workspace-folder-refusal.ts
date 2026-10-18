import { APP_NAME } from "@instrument-org/shared";
import { z } from "zod";

/**
 * Why a folder can't be an Instrument folder, wherever one is picked, opened
 * or found at launch (`workspace-folder-check.ts`).
 */
export const FolderRefusalSchema = z.enum([
  /** The home folder itself. */
  "home",
  /** A folder with the home folder in it: `/Users`, `C:\Users`, a disk the home folder is on. */
  "around-home",
  /** The top of a disk, or the folder disks are mounted in. */
  "drive",
  /** The app's own data, its install folder, or `~/.instrument`, at or inside. */
  "own-data",
  /** A folder the operating system keeps for itself, at or inside. */
  "system",
  /** Where apps keep their settings and data (`~/Library`, `AppData`, `~/.config`), at or inside. */
  "apps-data",
  /** Inside another workspace this computer knows, or with one inside it. */
  "other-workspace",
]);

export type FolderRefusal = z.output<typeof FolderRefusalSchema>;

/**
 * What's wrong with the folder and what to pick instead, said to the person
 * as `${why}, so ${instead}.` once they picked it, or as `${why}.` where the
 * app found it already in use.
 */
export const FOLDER_REFUSAL_COPY: Record<
  FolderRefusal,
  { instead: string; why: string }
> = {
  "apps-data": {
    instead: "pick a folder in your home folder instead",
    why: "Apps keep their settings and data in that folder",
  },
  "around-home": {
    instead: "pick or make a folder inside your home folder",
    why: "That folder has your home folder in it",
  },
  drive: {
    instead: "make a folder on it and pick that instead",
    why: "That’s the top of a disk",
  },
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
  system: {
    instead: "pick a folder in your home folder instead",
    why: "Your computer keeps its system files in that folder",
  },
};

/** The sentence for a folder the person picked. */
export function folderRefusalSentence(refusal: FolderRefusal): string {
  const { instead, why } = FOLDER_REFUSAL_COPY[refusal];
  return `${why}, so ${instead}.`;
}
