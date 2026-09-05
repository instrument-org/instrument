import ms from "ms";
import { ok } from "neverthrow";
import { z } from "zod";

import { setupTool } from "./create-tool";

/**
 * The most a reply may carry. A text message, not a document: an outcome that
 * needs more than this is a thing the reply links to, and the cap is enforced
 * by the schema because a prompt only asks.
 */
export const REPLY_MAX_LENGTH = 600;

/**
 * The orchestrator's one voice.
 *
 * Nothing else it writes reaches the user: its assistant text is working
 * notes between tool calls, and a child task's transcript is the child's.
 * Everything a person reads from the orchestrator goes through this call,
 * which is what keeps every reply text-message length and what a later
 * notification channel hangs off, since one call already means "the user
 * should see this".
 */
export const Reply = setupTool({
  inputSchema: z.object({
    link: z.string().optional().meta({
      description:
        "Optional. One place the reply points at: a file path the user can open, or a URL. Omit when there is nothing to open.",
    }),
    text: z.string().trim().min(1).max(REPLY_MAX_LENGTH).meta({
      description: `What to say, at most ${REPLY_MAX_LENGTH} characters. One or two sentences in plain words, the way a person texts: what happened, or what you are doing, or the one question you need answered. No headings, no lists, no markdown.`,
    }),
  }),
  name: "reply",
  outputSchema: z.object({
    link: z.string().optional(),
    text: z.string(),
  }),
}).create({
  description: `Say something to the user. This is the only way anything you write reaches them; text outside this call is never shown. Keep it to a sentence or two. Call it as soon as you have something worth saying, and again when there is something new: an acknowledgment when work starts, one line when an outcome lands, a question when only the user can answer it.`,
  execute: ({ input }) =>
    Promise.resolve(ok({ link: input.link, text: input.text })),
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: () => ({ type: "text", value: "Sent." }),
});
