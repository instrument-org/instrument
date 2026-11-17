import { z } from "zod";

import { ChatIdSchema } from "./chat-id";
import { LayoutReadSchema, LayoutSnapshotSchema } from "./group-layout";

/**
 * What a tab is asked to show: a page by its address, a file or folder of
 * the user's by its path, or a chat, a built-in page, an app or a task by its
 * `instrument://` address.
 */
const WindowTabTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), url: z.string().optional() }),
  z.object({ address: z.string(), kind: z.literal("app") }),
  z.object({
    kind: z.literal("path"),
    /** The path as the agent wrote it; a folder's ends with a slash. */
    path: z.string(),
  }),
]);

export type WindowTabTarget = z.output<typeof WindowTabTargetSchema>;

/**
 * An agent's ask of the window's tabs. Opening makes a tab, on screen or
 * behind; the rest act on a tab already open, by its id.
 */
const WindowTabActionSchema = z.discriminatedUnion("kind", [
  z.object({
    /** A tab group to open it in, by its id, in place of beside the chat; the window stays on the group it shows. */
    group: z.string().optional(),
    kind: z.literal("open"),
    show: z.boolean(),
    target: WindowTabTargetSchema,
  }),
  /**
   * A file a chat's reply handed over, opened beside the chat as the turn
   * ends: in a tab of the agent's own, or the chat's group's tab already
   * showing it brought up. By its path as the reply wrote it.
   */
  z.object({ kind: z.literal("handOver"), path: z.string() }),
  z.object({
    kind: z.literal("replace"),
    tabId: z.string(),
    target: WindowTabTargetSchema,
  }),
  z.object({ kind: z.literal("close"), tabId: z.string() }),
  z.object({ kind: z.literal("show"), tabId: z.string() }),
  /** Brings a tab group's window forward, showing that group. */
  z.object({ group: z.string(), kind: z.literal("showGroup") }),
  /** Closes a tab group whole, as the sidebar's X does: onto the closed list, with an Undo, unless every tab is an agent's own the person never used. */
  z.object({ group: z.string(), kind: z.literal("closeGroup") }),
  /** Makes a new tab group of tabs, moved there as Move to New Tab Group moves one; the window stays on the group it shows. */
  z.object({ kind: z.literal("groupTabs"), tabIds: z.array(z.string()) }),
  /** Moves tabs into a tab group, as dropping each on its row does. */
  z.object({
    group: z.string(),
    kind: z.literal("moveTabs"),
    tabIds: z.array(z.string()),
  }),
  /** The window's History, newest first: what was closed, and with `closedOnly` false the places visited too. */
  z.object({
    closedOnly: z.boolean(),
    kind: z.literal("history"),
    limit: z.number().int().min(1),
  }),
  /** One entry of the window's closed list back, as History's restore and Shift+Cmd+T bring it. */
  z.object({ entry: z.string(), kind: z.literal("reopenClosed") }),
  /** Reads the text of the page in a page tab, as the person sees it. */
  z.object({ kind: z.literal("read"), tabId: z.string() }),
  /**
   * Brings a page tab's guest back, at the page it last showed, without
   * showing it: the window makes a tab's guest again only when the tab is
   * next shown after a launch, and a task working in the tab needs it before.
   */
  z.object({ kind: z.literal("restore"), tabId: z.string() }),
  /**
   * Gives a page an agent made with no tab its tab in the chat, right after
   * the chat's tab and behind, as the page goes somewhere: the guest is
   * already there, so the tab takes its id and nothing loads again.
   */
  z.object({ kind: z.literal("adopt"), tabId: z.string(), url: z.string() }),
  /**
   * A tab group as the chat reads it, by its id: by default the group of the
   * chat's tab the person last sent from. Asked at the moment a tab is named
   * and as a wake starts a turn, so it is never a copy that could be out of
   * date, and answered whether or not a page's guest is up.
   */
  z.object({ group: z.string().optional(), kind: z.literal("list") }),
  /** Every bookmark and bookmark folder, as the Bookmarks page lists them. */
  z.object({ kind: z.literal("bookmarks") }),
  /**
   * Keeps an address as a bookmark the way a menu's Add to Bookmarks does:
   * into its kind's folder of Other bookmarks, or left where it is when it
   * is kept already.
   */
  z.object({
    kind: z.literal("addBookmark"),
    title: z.string(),
    url: z.string(),
  }),
]);

export type WindowTabAction = z.output<typeof WindowTabActionSchema>;

/** One ask as the window receives it: the action, a request id its answer comes back under, and the chat it belongs to. */
export const WindowTabRequestSchema = z.object({
  action: WindowTabActionSchema,
  requestId: z.string(),
  /** The chat the tab belongs to; absent outside one. */
  chatId: ChatIdSchema.optional(),
});

export type WindowTabRequest = z.output<typeof WindowTabRequestSchema>;

/**
 * A bookmark or a bookmark folder as the window names it to the agent: the
 * root it is in (the bar, or Other bookmarks), the folder it is filed in by
 * name, its name, and a bookmark's address.
 */
export const ListedBookmarkSchema = z.object({
  folder: z.string().optional(),
  kind: z.enum(["bookmark", "folder"]),
  root: z.enum(["bar", "other"]),
  title: z.string(),
  url: z.string().optional(),
});

/** The window's answer: the tab acted on or made, or why nothing was done. */
export const WindowTabAnswerSchema = z.object({
  /** For an open: the tab waits behind what is up on its side, since the user is working there. */
  behind: z.boolean().optional(),
  error: z.string().optional(),
  /** For a group of tabs: the group made. */
  group: z.string().optional(),
  /** For a group's close: whether it went on the closed list, which leaves off a group of only an agent's own tabs the person never used. */
  isListed: z.boolean().optional(),
  /** For a history: its entries, newest first. */
  history: z
    .array(
      z.object({
        /** Where a visit went: a page's URL, a file's or folder's path, a chat's address. */
        address: z.string().optional(),
        /** When, in milliseconds since the epoch. */
        at: z.number(),
        /** A closed entry's id, which a reopen takes; a visit's, for telling rows apart. */
        id: z.string(),
        /** What it was: a tab, a side or a whole group closed, or a place visited. */
        kind: z.enum(["closedGroup", "closedSide", "closedTab", "visit"]),
        /** The row's words, as History shows them. */
        title: z.string(),
        context: z.string(),
      }),
    )
    .optional(),
  requestId: z.string(),
  tabId: z.string().optional(),
  /** For a list: the group as the chat reads it, the shape of its log's layout part. */
  read: LayoutReadSchema.optional(),
  /**
   * For a list: every open window, the one in front first, each with its
   * tab groups in sidebar order, every group's layout marked shown where its
   * window shows it.
   */
  windows: z
    .array(
      z.object({
        /** The window that answered, which the chat works in. */
        isThisWindow: z.boolean().optional(),
        groups: z.array(LayoutSnapshotSchema),
      }),
    )
    .optional(),
  /** For a list: the group's page tabs, each with the address its page shows. */
  pages: z
    .array(z.object({ id: z.string(), title: z.string(), url: z.string() }))
    .optional(),
  /** The page's text, for a read. */
  text: z.string().optional(),
  /** For a bookmarks list: every folder and bookmark, the bar's then Other bookmarks', each folder before what is filed in it. */
  bookmarks: z.array(ListedBookmarkSchema).optional(),
  /** For a bookmark's add: the bookmark, and whether it was kept already. */
  bookmark: ListedBookmarkSchema.extend({ isNew: z.boolean() }).optional(),
});

export type WindowTabAnswer = z.output<typeof WindowTabAnswerSchema>;
