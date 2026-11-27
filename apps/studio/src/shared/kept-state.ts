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
 * as a folder each in the workspace's `.instrument/drafts/` (`shared/drafts.ts`). Nor are
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

/** The key kept once a workspace's recent chats have opened as tab groups (`useOpenRecentChats`). */
export const RECENT_CHATS_KEY = "recent-chats-opened.v1";

/**
 * The key a window keeps where its card stood, in px from the window's left
 * and right edges, which the launch draws the window by before its page has
 * loaded (`launch-page.ts`).
 */
export const CARD_INSETS_KEY = "card-insets.v1";

const CardInsetsSchema = z.object({
  left: z.number().nonnegative(),
  right: z.number().nonnegative(),
});

export type CardInsets = z.output<typeof CardInsetsSchema>;

/** The card insets a window kept, or undefined for a value that is not them. */
export function keptCardInsetsOf(value: unknown): CardInsets | undefined {
  return CardInsetsSchema.safeParse(value).data;
}

/** The tab groups a window kept, or undefined for a value that is not a list of them. */
export function keptTabGroupsOf(value: unknown): string[] | undefined {
  return z.array(z.string()).safeParse(value).data;
}

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
  /** A window asking one change of the tabs (`TabsAsk`). */
  tabs: "kept-state:tabs",
  /** The main process telling a window what a change to the tabs changed (`TabsChanged`). */
  tabsChanged: "kept-state:tabs-changed",
} as const;

/**
 * One change a window asks of the tabs. The main process owns the tabs: it
 * applies each ask to them as they are when it arrives, one after another
 * whichever window sent it, so two windows changing one group never undo
 * each other. The change is a name and plain data (`tab-ops.ts`), with what
 * is true only of the window asking beside it.
 */
export interface TabsAsk {
  command: { args: readonly unknown[]; op: string };
  /** The ask's own id, by which the window knows the answer to it. */
  id: string;
  /** The group the window has on screen. */
  onScreen?: string;
  /** Which tab each was opened from, as the window saw it (`tab-openers.ts`). */
  openers?: unknown;
}

/**
 * What a change to the tabs changed: each kept member that is different
 * after it, all at once, so a window never shows half of a tab's move. The
 * window that asked is told which ask this answers, changes or none.
 */
export interface TabsChanged {
  answers?: string;
  changes: [file: KeptFile, key: string, value: unknown][];
}

/** The tab groups, kept a group at a time under this key and the group's id. */
export const WINDOW_TABS_KEY = "tab-groups.v3";

/** The member the tabs with no group are kept under. */
export const NO_GROUP_MEMBER = "-";

/** What a site's group key starts with: a site opened at the window's own level, which lives as long as a window tab's history can come back to it. */
export const SITE_GROUP_PREFIX = "site:";

/**
 * The tab group members no window file lists, or with no tabs left, which go
 * (`TAB_GROUPS_KEY`): a group exists only while some window, open or closed
 * to come back, lists it. The tabs with no group and a site's group have
 * lifetimes of their own, and stay.
 */
export function unlistedTabGroups(
  members: Record<string, unknown>,
  listed: ReadonlySet<string>,
): string[] {
  const prefix = `${WINDOW_TABS_KEY}/`;
  return Object.entries(members).flatMap(([key, member]) => {
    const group = key.slice(prefix.length);
    if (
      !key.startsWith(prefix) ||
      group === NO_GROUP_MEMBER ||
      group.startsWith(SITE_GROUP_PREFIX)
    ) {
      return [];
    }
    const sides = z
      .object({ sides: z.array(z.object({ tabs: z.array(z.unknown()) })) })
      .safeParse(member).data?.sides;
    const hasTabs = sides?.some((side) => side.tabs.length > 0) === true;
    return listed.has(group) && hasTabs ? [] : [key];
  });
}

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
