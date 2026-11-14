import { z } from "zod";

import { ChatIdSchema } from "./chat-id";
import { LayoutReadSchema } from "./group-layout";

/** What a tab is asked to show: a page by its address, or a file or folder of the user's by its path. */
const WindowTabTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), url: z.string().optional() }),
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
    kind: z.literal("open"),
    show: z.boolean(),
    target: WindowTabTargetSchema,
  }),
  z.object({
    kind: z.literal("replace"),
    tabId: z.string(),
    target: WindowTabTargetSchema,
  }),
  z.object({ kind: z.literal("close"), tabId: z.string() }),
  z.object({ kind: z.literal("show"), tabId: z.string() }),
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

/** The window's answer: the tab acted on or made, or why nothing was done. */
export const WindowTabAnswerSchema = z.object({
  /** For an open: the tab waits behind what is up on its side, since the user is working there. */
  behind: z.boolean().optional(),
  error: z.string().optional(),
  requestId: z.string(),
  tabId: z.string().optional(),
  /** For a list: the group as the chat reads it, the shape of its log's layout part. */
  read: LayoutReadSchema.optional(),
  /** For a list: the group's page tabs, each with the address its page shows. */
  pages: z
    .array(z.object({ id: z.string(), title: z.string(), url: z.string() }))
    .optional(),
  /** The page's text, for a read. */
  text: z.string().optional(),
});

export type WindowTabAnswer = z.output<typeof WindowTabAnswerSchema>;
