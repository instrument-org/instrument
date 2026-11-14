import { z } from "zod";

/**
 * What a tab shows, in the words the agent reads: a website, a chat, a new
 * chat (the zero state), a folder or a file in Files, or a page of the app's
 * own (Settings, Memory, Skills, History, Activity, Apps).
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
 * A chat's tab group as it stood when a message was sent: one side or two,
 * left first, each its tabs in order with the one up marked, which side has
 * the keyboard, and which tab is the chat itself.
 */
export const LayoutSnapshotSchema = z.object({
  /** The side that has the keyboard, by its place in `sides`. */
  focused: z.number().int().min(0).max(1),
  group: z.object({ id: z.string(), title: z.string() }),
  sides: z
    .array(z.object({ tabs: z.array(LayoutTabSchema) }))
    .min(1)
    .max(2),
});

export type LayoutSnapshot = z.output<typeof LayoutSnapshotSchema>;

/** A side named by where it stands in its layout; absent when the group is one side. */
const SideSchema = z.enum(["left", "right"]).optional();

export type LayoutSideName = z.output<typeof SideSchema>;

/** A tab as a change names it: as it stands after, or as it last stood for one that went. */
const ChangedTabSchema = LayoutTabSchema.pick({
  address: true,
  id: true,
  isThisChat: true,
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
    /** The title of the window's other tab group it came from. */
    from: z.string(),
    side: SideSchema,
    tab: ChangedTabSchema,
  }),
  z.object({
    change: z.literal("movedOut"),
    tab: ChangedTabSchema,
    /** The title of the window's other tab group it went to. */
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
    change: z.literal("chatMoved"),
    /** The title of the tab group the chat was in. */
    from: z.string(),
    /** The title of the tab group it is in now. */
    to: z.string(),
  }),
]);

export type LayoutChange = z.output<typeof LayoutChangeSchema>;

/**
 * What a message carries about its chat's tab group: the layout as the
 * message was sent, and what changed in it since the chat's last message,
 * which a chat's first message and a window that has not sent in the chat
 * yet have none of.
 */
export const LayoutSentSchema = z.object({
  changes: z.array(LayoutChangeSchema),
  layout: LayoutSnapshotSchema,
});

export type LayoutSent = z.output<typeof LayoutSentSchema>;
