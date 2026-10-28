import { z } from "zod";

import { ChatIdSchema } from "./chat-id";

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
   * Puts a page an agent made with no tab into the chat's tabs behind
   * whatever is up, as it goes somewhere: the guest is already there, so
   * the tab takes its id and nothing is loaded again.
   */
  z.object({ kind: z.literal("adopt"), tabId: z.string(), url: z.string() }),
  /**
   * A page tab of the person's own, outside every chat, which a note on
   * their message named: its title and address, for the card that asks for
   * it. Answered with `tabs`, or an error when no such tab is open.
   */
  z.object({ kind: z.literal("theirs"), tabId: z.string() }),
  /**
   * Moves a page tab of the person's own into the chat, guest, history and
   * all, and puts it up there: their answer to a card asking for it.
   */
  z.object({ kind: z.literal("take"), tabId: z.string() }),
  /**
   * The chat's tabs, which are the only tabs it may name, hand to a task, or
   * have an agent drive. Asked at the moment a tab is named, so it is never
   * a copy that could be out of date, and answered whether or not a page's
   * guest is up: a tab whose page was discarded is still the chat's.
   */
  z.object({ kind: z.literal("list") }),
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
  error: z.string().optional(),
  requestId: z.string(),
  tabId: z.string().optional(),
  /**
   * The chat's tabs, for a list: each by its id, with the address of a
   * page's, and `front` on the one the person sees, the tab the chat has up
   * while the chat is on screen.
   */
  tabs: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          front: z.boolean().optional(),
          id: z.string(),
          kind: z.literal("page"),
          title: z.string(),
          url: z.string(),
        }),
        z.object({
          front: z.boolean().optional(),
          id: z.string(),
          kind: z.literal("screen"),
        }),
      ]),
    )
    .optional(),
  /** The page's text, for a read. */
  text: z.string().optional(),
});

export type WindowTabAnswer = z.output<typeof WindowTabAnswerSchema>;
