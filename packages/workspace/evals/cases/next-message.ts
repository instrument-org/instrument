/**
 * Does a chat at rest offer a next message, and what does asking cost?
 *
 * Once a chat settles, the app asks the model the last reply ran on for the
 * person's likely next message, with that reply's request as the prefix.
 * One case ends on finished work, where a suggestion is expected; one on a
 * thank-you, where none is. Each waits for the ask to finish, and its
 * evidence carries the ask's tokens, which is how much of the prefix the
 * provider's cache served.
 */
import { type LanguageModelUsage } from "ai";

import {
  chatNextMessage,
  lastNextMessageAsk,
  watchNextMessage,
} from "../../src/lib/chat/next-message";
import { type ChatId } from "../../src/schemas/chat-id";
import { type Assertion, defineEval } from "../harness";

/** How long the ask may take once the chat has settled. */
const WAIT_MS = 60_000;

async function askOf(chatId: ChatId) {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const ask = lastNextMessageAsk(chatId);
    if (ask || Date.now() > until) {
      return ask;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function tokens(usage: LanguageModelUsage): string {
  return `in ${usage.inputTokens ?? "?"} (cache read ${usage.inputTokenDetails.cacheReadTokens ?? "?"}, write ${usage.inputTokenDetails.cacheWriteTokens ?? "?"}), out ${usage.outputTokens ?? "?"} (reasoning ${usage.outputTokenDetails.reasoningTokens ?? "?"})`;
}

function offered(expected: boolean): Assertion {
  const text = expected
    ? "offers a next message of a line"
    : "offers no next message";
  return {
    check: async ({ chatId }) => {
      const ask = await askOf(chatId);
      const said = await chatNextMessage(chatId);
      const passed =
        ask !== undefined &&
        (expected
          ? said !== undefined && said.split(/\s+/).length <= 14
          : said === undefined);
      return {
        evidence: ask
          ? `suggested: ${said === undefined ? "nothing" : JSON.stringify(said)} (answered ${JSON.stringify(ask.answer.slice(0, 120))}) · ${tokens(ask.usage)}`
          : "never asked",
        passed,
        text,
      };
    },
    text,
  };
}

/** No window shows an eval's chat, so the case stands in for one on every chat. */
function aWindowOnEveryChat() {
  watchNextMessage();
}

export const NEXT_MESSAGE_EVALS = [
  defineEval({
    assertions: [offered(true)],
    kind: "chat",
    name: "next-message-after-work",
    prompt: "Give me a three-item packing list for a rainy weekend in Seattle.",
    setup: aWindowOnEveryChat,
  }),
  defineEval({
    assertions: [offered(false)],
    kind: "chat",
    name: "next-message-after-thanks",
    prompt: "Thanks, that's all I needed!",
    setup: aWindowOnEveryChat,
  }),
  // The agent ends on a yes-or-no offer, which the person answers with a yes.
  defineEval({
    assertions: [offered(true)],
    kind: "chat",
    name: "next-message-after-offer",
    prompt:
      "Write me a two-line poem about rain, then ask whether I want it saved as a file. Don't save it yet.",
    setup: aWindowOnEveryChat,
  }),
];
