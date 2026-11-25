import { z } from "zod";

/**
 * What a tab shows, in the words the agent reads: a website, a chat, a new
 * chat (the zero state), a folder or a file in Files, or a page of the app's
 * own (Settings, Memory, Skills, Chats, Activity, Apps).
 */
const LayoutTabKindSchema = z.enum([
  "builtIn",
  "chat",
  "file",
  "folder",
  "newChat",
  "website",
]);

export type LayoutTabKind = z.output<typeof LayoutTabKindSchema>;

const LayoutTabSchema = z.object({
  /** Where it is: a website's URL, a file's or a folder's path, or an `instrument://` address. */
  address: z.string(),
  /** Opened by an agent, this chat's or another's, rather than the person. */
  byAgent: z.boolean().optional(),
  /** The tab's id, which stays with it as it moves and navigates. */
  id: z.string(),
  /** The chat the layout was read for. */
  isThisChat: z.boolean().optional(),
  /** The tab up on its side, which is what the person sees there. */
  isUp: z.boolean().optional(),
  kind: LayoutTabKindSchema,
  title: z.string(),
});

export type LayoutTab = z.output<typeof LayoutTabSchema>;

/**
 * The tab group a chat works in, as it stood when read: its sides, the
 * first leftmost, each its tabs in order with the one up marked, which side
 * has the keyboard, and which tab is the chat itself, the one the person
 * last sent it a message from. Writers write one side or two; a reader takes
 * any number, so a record a later layout writes still reads here.
 */
export const LayoutSnapshotSchema = z.object({
  /** The side that has the keyboard, by its place in `sides`. */
  focused: z.number().int().min(0),
  /** The group, by the id the `window` command takes. */
  group: z.object({ id: z.string() }),
  /** False while the window shows another group, so none of this one is on screen. */
  isShown: z.boolean().optional(),
  sides: z.array(z.object({ tabs: z.array(LayoutTabSchema) })).min(1),
});

export type LayoutSnapshot = z.output<typeof LayoutSnapshotSchema>;

/** What a page's tab or its sidebar row is marked with, past what it shows. */
export const PageMarkSchema = z.object({
  /** Its page could not be reached, so its row says it can't connect. */
  failed: z.literal(true).optional(),
  /** What it is using of the two, and whether the person paused that. */
  using: z
    .object({
      camera: z.boolean(),
      microphone: z.boolean(),
      paused: z.boolean(),
    })
    .optional(),
});

export type PageMark = z.output<typeof PageMarkSchema>;

/**
 * A tab group as a window lists it: its layout, and what its sidebar row
 * and its tabs say of it besides. Answered fresh to each ask and never
 * written to a chat's log, which keeps the layout alone.
 */
export const ListedGroupSchema = LayoutSnapshotSchema.extend({
  /** The words typed and not sent in a new chat's tab, by the tab's id. */
  drafts: z.record(z.string(), z.string()).optional(),
  /** What a page's tab is marked with, by the tab's id. */
  marks: z.record(z.string(), PageMarkSchema).optional(),
  /** What its sidebar row calls it, which the person reads out and a command names it by. */
  name: z.string(),
  /** Pinned above the sidebar's other groups. */
  pinned: z.boolean().optional(),
  /** The project whose set of groups it is in, by its id. */
  project: z.string().optional(),
  /** When a window last came to show it, in ms; absent when none has since that was first kept. */
  shownAt: z.number().optional(),
});

export type ListedGroup = z.output<typeof ListedGroupSchema>;

/**
 * A side named by where it stands in its layout; absent when the group is
 * one side. Writers name `left` or `right`; a reader takes any name, so a
 * side a later layout names (`top`) still reads here.
 */
const SideSchema = z.string().optional();

export type LayoutSideName = z.output<typeof SideSchema>;

/** A tab as a change names it: as it stands after, or as it last stood for one that went. */
const ChangedTabSchema = LayoutTabSchema.pick({
  address: true,
  id: true,
  isThisChat: true,
  isUp: true,
  kind: true,
  title: true,
});

export type ChangedTab = z.output<typeof ChangedTabSchema>;

/** Marks a change an agent made, this chat's or another's, rather than the person. */
const ByAgentSchema = z.boolean().optional();

/**
 * One change to a chat's tab group between two of its messages, by tab. A
 * side is named as the layout it belongs to has it: where a tab stands now
 * by the later layout, where it came from by the earlier. `beside` marks a
 * tab that now stands on the side the chat is not on.
 */
export const LayoutChangeSchema = z.discriminatedUnion("change", [
  z.object({
    beside: z.boolean().optional(),
    byAgent: ByAgentSchema,
    change: z.literal("opened"),
    side: SideSchema,
    tab: ChangedTabSchema,
  }),
  z.object({
    byAgent: ByAgentSchema,
    change: z.literal("closed"),
    tab: ChangedTabSchema,
  }),
  z.object({
    beside: z.boolean().optional(),
    change: z.literal("movedIn"),
    /** The id of the tab group it came from. */
    from: z.string(),
    side: SideSchema,
    tab: ChangedTabSchema,
  }),
  z.object({
    change: z.literal("movedOut"),
    tab: ChangedTabSchema,
    /** The id of the tab group it went to. */
    to: z.string(),
  }),
  z.object({
    /** The title of the tab it now follows on its side, or absent at the front. */
    after: z.string().optional(),
    beside: z.boolean().optional(),
    change: z.literal("moved"),
    from: SideSchema,
    tab: ChangedTabSchema,
    to: SideSchema,
  }),
  z.object({
    byAgent: ByAgentSchema,
    change: z.literal("navigated"),
    from: ChangedTabSchema.pick({ address: true, kind: true, title: true }),
    tab: ChangedTabSchema,
  }),
  z.object({
    change: z.literal("shown"),
    /** The side that shows it now. */
    side: SideSchema,
    /** A tab that was in the group before and is now the one its side shows. */
    tab: ChangedTabSchema,
  }),
  z.object({
    change: z.literal("groupShown"),
    /** Whether the window shows the group now, after showing another or before it. */
    isShown: z.boolean(),
  }),
  z.object({
    change: z.literal("chatMoved"),
    /** The id of the tab group the chat worked in. */
    from: z.string(),
    /** The id of the tab group it works in now. */
    to: z.string(),
  }),
]);

export type LayoutChange = z.output<typeof LayoutChangeSchema>;

/** By tab id, the id of a tab group. */
const TabGroupsSchema = z.record(z.string(), z.string());

/**
 * The tab group a chat works in as the window read it, with the tabs that
 * moved between it and another group: what a message carries, and what the
 * window answers a wake. Only `layout` is written to the chat's log; the
 * moves tell a tab moved in or out from one opened or closed.
 */
export const LayoutReadSchema = z.object({
  layout: LayoutSnapshotSchema,
  /** The tabs now in the group that came from another, by the group each came from. */
  movedIn: TabGroupsSchema,
  /** The tabs now in another group that came from this one, by the group each is in. */
  movedOut: TabGroupsSchema,
});

export type LayoutRead = z.output<typeof LayoutReadSchema>;
