import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { ChatReads } from "../lib/chat-reads";
import { sessionRole } from "../lib/chat/children";
import {
  feedbackOfferRefusal,
  lastFeedbackOffer,
  recordFeedbackOffer,
} from "../lib/feedback-offers";
import { getCurrentDate } from "../lib/get-current-date";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { type SessionMessage } from "../schemas/session/message";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/** The longest write-up a card takes. */
const FEEDBACK_WRITEUP_MAX_LENGTH = 2000;

const OfferFeedbackOutputSchema = z.union([
  z.object({
    offered: z.literal(true),
    /**
     * What the person did on the card, written onto the call when they do
     * it. The model never reads it, so the call reads the same to it before
     * and after.
     */
    outcome: z.enum(["sent", "dismissed"]).optional(),
  }),
  z.object({
    offered: z.literal(false),
    reason: z.enum(["background", "this-chat", "recent", "off"]),
  }),
]);

/**
 * Offer to send the Instrument team a problem the agent found in the app
 * itself. Like `connect_app`, it puts a card in the chat and returns at once,
 * and what the person does on the card never wakes the chat.
 *
 * Kept rare by refusals rather than by the prompt: once per chat, never from
 * a task, never while the person has turned offers off, and days apart
 * across the workspace (`lib/feedback-offers.ts`). A refused call shows no
 * card.
 */
export const OfferFeedback = setupTool({
  inputSchema: BaseInputSchema.extend({
    title: z.string().trim().min(1).max(120).meta({
      description:
        "One plain line naming what broke: 'Browser tab crashed on zendesk.com/pricing'.",
    }),
    writeup: z.string().trim().min(1).max(FEEDBACK_WRITEUP_MAX_LENGTH).meta({
      description:
        "Plain Markdown facts for the team, a few short lines: what you were doing, what happened (error text verbatim), what you tried, what you did instead. No apology, no guessed cause, nothing about the user the problem doesn't need.",
    }),
  }),
  name: "offer_feedback",
  outputSchema: OfferFeedbackOutputSchema,
}).create({
  description: dedent`
    Offer to send the Instrument team a short write-up of something broken in Instrument itself: its browser, shell, file tools, or an app connection failing in a way neither the request nor the site explains. The user sees your write-up on a card and decides whether to send it with the chat. Not for a site that is down or refuses you, a model refusing, a missing permission, your own mistake, or anything the user did. The card is the whole offer, and often none is shown, so your reply carries on with the work. It returns at once.
  `,
  execute: async ({ chatId, sessionId }) => {
    if (sessionRole(chatId, sessionId) !== "chat") {
      return ok({ offered: false as const, reason: "background" as const });
    }
    const history = await ChatReads.history({ chatId, sessionId });
    if (history.isOk() && offeredIn(history.value)) {
      return ok({ offered: false as const, reason: "this-chat" as const });
    }
    const now = getCurrentDate();
    const refusal = feedbackOfferRefusal({
      last: await lastFeedbackOffer(),
      mayOffer: getWorkspaceConfig().mayOfferFeedback?.() ?? true,
      now,
    });
    if (refusal) {
      return ok({ offered: false as const, reason: refusal });
    }
    await recordFeedbackOffer(now);
    return ok({ offered: true as const });
  },
  readOnly: false,
  timeoutMs: ms("10 seconds"),
  toModelOutput: ({ output }) => ({
    type: "text",
    value: output.offered
      ? "The user sees your write-up on a card and decides there; your reply carries on with the work."
      : output.reason === "background"
        ? "No card: only the chat offers this. Say what broke in your report to the chat."
        : "No card was shown this time, as is usual; your reply carries on with the work.",
  }),
});

/** Whether the chat already showed a card for an offer. */
export function offeredIn(messages: readonly SessionMessage.WithParts[]) {
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "tool-offer_feedback" &&
        part.state === "output-available" &&
        part.output.offered,
    ),
  );
}
