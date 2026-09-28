import { z } from "zod";

import { StoreId } from "./store-id";

/** What a tab is asked to show: a page by its address, or a file or folder of the user's by its path. */
export const WindowTabTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), url: z.string().optional() }),
  z.object({
    kind: z.literal("path"),
    /** The path as the agent wrote it; a folder's ends with a slash. */
    mount: z.string(),
  }),
]);

export type WindowTabTarget = z.output<typeof WindowTabTargetSchema>;

/**
 * An agent's ask of the window's tabs. Opening makes a tab, on screen or
 * behind; the rest act on a tab already open, by its id.
 */
export const WindowTabActionSchema = z.discriminatedUnion("kind", [
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
]);

export type WindowTabAction = z.output<typeof WindowTabActionSchema>;

/** One ask as the window receives it: the action, a request id its answer comes back under, and the chat it belongs to. */
export const WindowTabRequestSchema = z.object({
  action: WindowTabActionSchema,
  requestId: z.string(),
  /** The chat the tab belongs to, by its session; absent outside one. */
  sessionId: StoreId.SessionSchema.optional(),
});

export type WindowTabRequest = z.output<typeof WindowTabRequestSchema>;

/** The window's answer: the tab acted on or made, or why nothing was done. */
export const WindowTabAnswerSchema = z.object({
  error: z.string().optional(),
  requestId: z.string(),
  tabId: z.string().optional(),
});

export type WindowTabAnswer = z.output<typeof WindowTabAnswerSchema>;
