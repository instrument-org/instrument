import { z } from "zod";

/**
 * The files that hold what the app's windows keep across launches. The main
 * process owns them; a window reads them all once as it loads and writes a
 * key back as it changes.
 *
 * They split by what losing one costs: `groups` is the tab groups and their
 * tabs, `layout` the rest of where the person left off, and `view` how they
 * like things laid out. All stay on this computer, in the workspace's
 * machine folder. Drafts are not kept here: main owns them
 * as a folder each in the workspace's `Drafts/` (`shared/drafts.ts`). Nor are
 * bookmarks: they are a synced store every device writes its own file of
 * (`shared/bookmarks.ts`).
 */
export const SHARED_KEPT_FILES = ["groups", "layout", "view"] as const;

/**
 * What one window keeps for itself, where the others keep their own: its
 * strip of tabs and what it had up. A key of a shared file is the same
 * for every window, and each window's write reaches the others; a key of
 * `window` goes with the window it was written in.
 */
export const WINDOW_KEPT_FILE = "window";

const KEPT_FILES = [...SHARED_KEPT_FILES, WINDOW_KEPT_FILE] as const;

export type KeptFile = (typeof KEPT_FILES)[number];

/** The key a window keeps its strip of tabs under. */
export const APP_TABS_KEY = "app-tabs.v2";

/**
 * The key a window keeps its open tab groups under, by their ids, in its own
 * order. A window with nothing under it has opened none.
 */
export const TAB_GROUPS_KEY = "tab-group-list.v2";

/** The tab groups a window kept, or undefined for a value that is not a list of them. */
export function keptTabGroupsOf(value: unknown): string[] | undefined {
  return z.array(z.string()).safeParse(value).data;
}

/** The key a window keeps its floating drafts and chats under. */
export const COMPOSE_KEY = "compose.v2";

/** Every kept file's keys and values, as a window loads them. */
export type KeptSnapshot = Partial<Record<KeptFile, Record<string, unknown>>>;

export function isKeptFile(file: unknown): file is KeptFile {
  return KEPT_FILES.some((name) => name === file);
}

/**
 * The IPC channels between a window and the kept state: `load` is the
 * preload's synchronous read of every file, `set` a window's write of one key
 * (`undefined` removes it), `changed` the main process telling the other
 * windows about a write, and `otherWindows` a synchronous read of one key of
 * `window` as every other window kept it, closed ones that can come back
 * included.
 */
export const KEPT_STATE_CHANNEL = {
  otherWindows: "kept-state:other-windows",
  changed: "kept-state:changed",
  load: "kept-state:load",
  set: "kept-state:set",
} as const;

/** The tab groups, kept a group at a time under this key and the group's id. */
export const WINDOW_TABS_KEY = "tab-groups.v2";

/** The group of a page drawn inside a surface of one window, such as a file's page in its viewer. */
export const HOSTED_PAGE_GROUP_PREFIX = "page:";

/**
 * Which file a group of window tabs is kept in. A tab group belongs to this
 * computer whichever window shows it. A page drawn inside a surface is that window's alone,
 * made when the surface comes and closed when it goes, so another window showing
 * the same tab draws a page of its own and is not left blank by this one's going.
 */
export function fileOfTabGroup(group: string): KeptFile {
  return group.startsWith(HOSTED_PAGE_GROUP_PREFIX) ? "window" : "groups";
}

/** Whether a key a window keeps is the tab of a page drawn inside its surfaces, which goes with no other window. */
export function isHostedPageKey(key: string) {
  return key.startsWith(`${WINDOW_TABS_KEY}/${HOSTED_PAGE_GROUP_PREFIX}`);
}
