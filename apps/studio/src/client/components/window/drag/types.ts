import { type SidebarDrop } from "../sidebar-drop";
import { type Rect } from "./landing";

/** A file or folder held, by where it is on the computer. */
export interface DroppedFile {
  hostPath: string;
  isFolder: boolean;
}

/**
 * What a drag holds: a group's tab, a whole group by its sidebar row, files
 * (the system's drag, from the Finder or from this app's own Files and file
 * cards), or a bookmark.
 */
export type Held =
  | {
      /** The group it is a tab of, and its side there. */
      group: string;
      id: string;
      /** What its strip knows it by (`stripKeyOf`). */
      key: string;
      kind: "tab";
      side: 0 | 1;
    }
  | {
      group: string;
      /** The half of a row of two sides it was pressed by, whose tab up is the one a side's page takes. */
      half?: 0 | 1;
      /** The room its row takes in a list, its height and the space under it. */
      height: number;
      kind: "group";
    }
  | {
      /** How many, which the system's drag says from the start. */
      count: number;
      /** What they are, once main has read them off the system's drag. */
      files: readonly DroppedFile[] | undefined;
      /** The ids their tabs are drawn under while held, and open under. */
      ids: readonly string[];
      kind: "files";
    }
  | {
      id: string;
      kind: "bookmark";
      title: string;
      /** The address it keeps, a site's or the app's own. */
      url: string;
    };

/**
 * What letting go would do: stand among a side's tabs at a place; join a
 * side as its last tab, or make one end of a lone side a side of its own; go
 * into a sidebar row's group, or be a group of its own in a room between
 * rows; turn a new tab into it; or stand among the bookmarks on the bar.
 */
export type Landing =
  | { group: string; index: number; kind: "strip"; side: 0 | 1 }
  | { group: string; kind: "side"; lit: Rect; side: 0 | 1; split: boolean }
  | { drop: SidebarDrop; kind: "sidebar" }
  | { group: string; kind: "newTab"; lit: Rect; tab: string }
  | { index: number; kind: "bookmarks" };
