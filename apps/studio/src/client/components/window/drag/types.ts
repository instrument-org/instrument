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
 * bookmark or a folder of the bar, a shortcut at the bar's start, a place
 * of Files' sidebar or Files menu) is held by the pointer (`WindowHeld`); content (files
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
      /** A folder of the bookmarks bar, by id, which moves along the bar and lands nowhere else. */
      folder: string;
      kind: "folder";
      title: string;
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
      /**
       * A place of Files' sidebar or of the bar's Files menu, a link to
       * Files at a folder, held by the pointer so the folder itself never
       * leaves the app: its path, and for a row of Favorites, the Favorites rows'
       * paths in order at the press, since let go where nothing takes it
       * it leaves Favorites, and Undo puts it back there.
       */
      place?: { path: string; favorites?: readonly string[] };
      /**
       * Apps, Chats or Files at the bookmarks bar's start, or a row of their
       * menus: a link to where it opens, held by the pointer and landing
       * where a bookmark does, though it is no bookmark kept, so the bar's
       * row adds it as one.
       */
      shortcut?: true;
      /** Its name, empty where the system's drag says it only at the release. */
      title: string;
      /** The address it names, empty where the system's drag says it only at the release. */
      url: string;
    };

/**
 * What letting go would do: stand among a side's tabs at a place; join a
 * side as its last tab, or make one end of a lone side a side of its own; go
 * into a sidebar row's group, or be a group of its own in a room between
 * rows; turn a new tab into it, or open in a strip's tab in place of what it
 * shows; stand among the bookmarks on the bar; stand among the rows of
 * Files' Favorites, or go into the folder of one; leave Favorites, for one of
 * its places let go where nothing takes it; go with a message, for a place
 * let go on the box of the composer `box` names; or go to a window of its
 * own: a whole group pulled free of the sidebar, or a link let go past the
 * window's edge.
 */
export type Landing =
  | {
      group: string;
      index: number;
      kind: "strip";
      /** The line in the gap it lands at, in the window's px, where the strip stands still for what came from elsewhere; none where its own tab moves along it. */
      line?: Rect;
      side: 0 | 1;
    }
  | {
      /** The line down the group's outer edge, where the pointer is at it. */
      edge?: Rect;
      group: string;
      /** Joining the group's only side, as a new tab of it. */
      isLone?: true;
      kind: "side";
      lit: Rect;
      side: 0 | 1;
      split: boolean;
    }
  | {
      /** Where among Favorites' rows it stands, from the top. */
      index: number;
      kind: "favorite";
      /** The line between the rows, in the window's px. */
      line: Rect;
      /** Whether it is a row of Favorites already, which moves there. */
      moves: boolean;
    }
  | {
      /** Whether files from elsewhere are copied in, rather than moved as Files' own are. */
      copies: boolean;
      /** The folder, by where it is on the computer. */
      folder: string;
      kind: "into";
      /** Its row, in the window's px. */
      lit: Rect;
      name: string;
    }
  | { kind: "unfavorite"; path: string }
  | { box: string; kind: "attach" }
  | { drop: SidebarDrop; kind: "sidebar" }
  | { group: string; kind: "newTab"; lit: Rect; tab: string }
  | {
      group: string;
      kind: "replace";
      /** The tab, in the window's px. */
      lit: Rect;
      side: 0 | 1;
      tab: string;
    }
  | {
      /** The bar's folder it goes into, at `index` among what is in it; on the bar itself without one. */
      folder?: string;
      index: number;
      kind: "bookmarks";
    }
  | { kind: "window" };

/**
 * What the pointer path holds: a piece of the window itself, a tab, a whole
 * group by its row, a bookmark of the bar or a shortcut at its start, or a
 * place of Files' sidebar. It
 * moves where it lands, as itself, and leaves the window only as main
 * carries a tab or a group.
 */
export type WindowHeld =
  | Extract<Held, { kind: "folder" | "group" | "tab" }>
  | (Extract<Held, { kind: "link" }> & { bookmark: string })
  | (Extract<Held, { kind: "link" }> & { shortcut: true })
  | (Extract<Held, { kind: "link" }> & {
      place: NonNullable<Extract<Held, { kind: "link" }>["place"]>;
    });

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

/**
 * A link that opens as a tab from a strip or a page's outer edge and nowhere
 * else on a page: a bookmark of the bar, or a shortcut from its start.
 */
export function opensAsBookmark(held: Held): boolean {
  return isBookmark(held) || (held.kind === "link" && held.shortcut === true);
}

/** The place of Files' sidebar or Files menu a link is, if it is one. */
export function placeOf(held: Held) {
  return held.kind === "link" ? held.place : undefined;
}
