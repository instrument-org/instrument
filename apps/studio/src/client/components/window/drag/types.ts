import { type SidebarDrop } from "../sidebar-drop";
import { type Rect } from "./landing";

/** A file or folder held, by where it is on the computer. */
export interface DroppedFile {
  hostPath: string;
  isFolder: boolean;
}

/**
 * What a drag holds, on one of two paths decided by what was grabbed. A
 * piece of the window (a group's tab, a whole group by its sidebar row, a
 * bookmark of the bar) is held by the pointer (`WindowHeld`); content (files
 * from the Finder, Files, a file card or the address field, and a link from a
 * page, a reply, a chip, a row of the Chats list or the address field) is
 * held by the system's drag (`ContentHeld`). A link opens as the tab its
 * address names (`targetOfAddress`) wherever it lands.
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
      /** The bookmark of the bar it is, which moves on the bar and goes from it where nothing takes it. */
      bookmark?: string;
      /** The tab id it stands under while held, in a strip, a room or a side shown, and opens under. */
      id: string;
      kind: "link";
      /** Its name, empty where the system's drag says it only at the release. */
      title: string;
      /** The address it names, empty where the system's drag says it only at the release. */
      url: string;
    };

/**
 * What letting go would do: stand among a side's tabs at a place; join a
 * side as its last tab, or make one end of a lone side a side of its own; go
 * into a sidebar row's group, or be a group of its own in a room between
 * rows; turn a new tab into it; stand among the bookmarks on the bar; or go
 * to a window of its own: a whole group pulled free of the sidebar, or a
 * link let go past the window's edge.
 */
export type Landing =
  | { group: string; index: number; kind: "strip"; side: 0 | 1 }
  | { group: string; kind: "side"; lit: Rect; side: 0 | 1; split: boolean }
  | { drop: SidebarDrop; kind: "sidebar" }
  | { group: string; kind: "newTab"; lit: Rect; tab: string }
  | {
      /** The bar's folder it goes into, at `index` among what is in it; on the bar itself without one. */
      folder?: string;
      index: number;
      kind: "bookmarks";
    }
  | { kind: "window" };

/**
 * What the pointer path holds: a piece of the window itself, a tab, a whole
 * group by its row, or a bookmark of the bar. It moves where it lands, as
 * itself, and leaves the window only as main carries a tab or a group.
 */
export type WindowHeld =
  | Extract<Held, { kind: "group" | "tab" }>
  | (Extract<Held, { kind: "link" }> & { bookmark: string });

/**
 * What the system's drag holds: files or a link, from another app or from
 * this one's own content (`useContentDrag`), which every target here takes
 * the same way and which can leave the app.
 */
export type ContentHeld = Extract<Held, { kind: "files" | "link" }>;

/** A link that is a bookmark of the bar. */
export function isBookmark(held: Held): boolean {
  return held.kind === "link" && held.bookmark !== undefined;
}
