import {
  CLIENT_SESSION_ID_HEADER,
  fetchAISDKModel,
  providerOptionsForModel,
} from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";
import {
  generateText,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { mapValues } from "radashi";

import { instrumentAgent } from "../../agents/instrument";
import { getWorkspaceServerURL } from "../../logic/server/url";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { activityTelemetry, connectionFor } from "../activity/record";
import { ChatReads } from "../chat-reads";
import { cacheSessionFor } from "../fork-cache-session";
import { prepareModelMessages, TRANSIENT } from "../prepare-model-messages";
import { getWorkspaceConfig } from "../workspace-config";
import { chatIsWorking } from "./chats";
import { openAsksUntil } from "./open-asks";

/**
 * The instruction the suggestion is asked with, after the chat's own
 * conversation: the person's likely next message, or nothing.
 */
const NEXT_MESSAGE_INSTRUCTION = `This message is from ${APP_NAME}, not the person, and they will not see it. Don't reply to them or use any tool.

Suggest the next message the person might send. It appears grayed out in their empty message box, and they can take it with one key.

Predict what they would type next, in their own words. The test: would they think "I was just about to type that"?

- Write it as the person, to the agent. Never in the agent's voice ("Let me…", "I'll…").
- Specific beats generic: "Summarize the two you found" beats "Continue".
- When the agent offered a next step or options, suggest the one the person would most likely take, in their words.
- A question is fine when it's the obvious next thing to ask about the answer they just got.
- Only what follows from what they asked for. No new ideas, no upselling, and nothing that takes their work somewhere they didn't mention (publishing, sharing, another app).
- Never suggest deleting, sending, buying, posting, or anything else that can't be undone, unless the person already said they want it done.
- 2 to 10 words, one line. Match how the person writes: their casing, punctuation and tone.

Answer with exactly NONE only when:
- the agent's last message ends by asking the person something, even in passing ("How's the new phone?"), or is waiting on a card (a permission, a sign-in, a choice): they answer that themselves;
- something failed or the agent is still working;
- the person just said thanks or goodbye;
- it would mean guessing at someone else's private life.

Otherwise suggest the likeliest next message. A finished answer still gets one: the follow-up they would most likely ask for next. Reply with only the suggestion or NONE, no quotes or explanation.`;

/** Room for a low-effort model's thinking and the line after it. */
const SUGGESTION_MAX_OUTPUT_TOKENS = 1024;

/**
 * Most of the last request the cache may leave unserved: past it, the ask
 * pays full price for a long tail, which a line in the box is not worth.
 */
const SUGGESTION_MAX_UNCACHED_TOKENS = 10_000;

/**
 * Whether the reply's last request left more than the cache serves: the
 * input it sent unserved plus what it wrote back, which the ask sends anew.
 * A provider that reports no cache figures is not judged by them.
 */
export function coldTail(usage: SessionMessage.Usage | undefined): boolean {
  const details = usage?.inputTokenDetails;
  const uncached =
    details?.noCacheTokens ??
    (usage?.inputTokens !== undefined && details?.cacheReadTokens !== undefined
      ? usage.inputTokens -
        details.cacheReadTokens -
        (details.cacheWriteTokens ?? 0)
      : undefined);
  if (uncached === undefined || Number.isNaN(uncached)) {
    return false;
  }
  return uncached + (usage?.outputTokens ?? 0) > SUGGESTION_MAX_UNCACHED_TOKENS;
}

/** The longest suggestion kept: past this it is not a line a box shows. */
const SUGGESTION_MAX_CHARS = 120;

/** What this computer suggested each chat's person send next. */
const suggestions = new Map<ChatId, string>();

/** Each chat's latest settle, so an ask a later settle overtook says nothing. */
const latestSettle = new Map<ChatId, symbol>();

/** What each chat's last ask answered and what it cost, for evals to read. */
const asked = new Map<
  ChatId,
  { suggestion?: string; usage: LanguageModelUsage }
>();

/** Whether the person lets chats suggest a next message, read fresh each time. */
function maySuggest(): boolean {
  return getWorkspaceConfig().maySuggestNextMessage?.() ?? true;
}

/** What the chat's last ask for a next message answered, and its usage; none before one finished. */
export function lastNextMessageAsk(chatId: ChatId) {
  return asked.get(chatId);
}

/**
 * The suggestion standing for the chat, or none once it is working again:
 * a message sent, or anything of its started, ends the moment it was for.
 */
export async function chatNextMessage(
  chatId: ChatId,
): Promise<string | undefined> {
  const suggestion = suggestions.get(chatId);
  if (!suggestion || !maySuggest()) {
    return undefined;
  }
  if (await chatIsWorking(chatId)) {
    suggestions.delete(chatId);
    return undefined;
  }
  return suggestion;
}

/**
 * Suggests the person's next message each time a chat settles, on the model
 * its last reply ran on and with that reply's own request as the prefix, so
 * the provider's cache serves all of it but the instruction. Nothing is
 * asked when the person stopped the turn, a card or question waits on them,
 * or the reply failed; the model answers nothing when no next message is
 * plain. Kept in memory on this computer, as what it shows at the moment.
 */
export function startNextMessageSuggestions(): void {
  void (async () => {
    for await (const settle of publisher.subscribe("chat.settled")) {
      const token = Symbol(settle.id);
      latestSettle.set(settle.id, token);
      if (settle.by !== undefined || !maySuggest()) {
        continue;
      }
      // Not awaited: one chat's call never holds another's.
      void suggestOnSettle(settle, token).catch((error: unknown) => {
        getWorkspaceConfig().captureException(error, { area: "next-message" });
      });
    }
  })();
}

async function suggestOnSettle(
  {
    id: chatId,
    sessionId,
  }: {
    id: ChatId;
    sessionId: StoreId.Session;
  },
  token: symbol,
): Promise<void> {
  suggestions.delete(chatId);
  if ((await openAsksUntil(chatId)).asks.length > 0) {
    return;
  }
  const transcript = await ChatReads.transcript({ chatId, sessionId });
  if (transcript.isErr()) {
    return;
  }
  const reply = transcript.value.findLast(
    (message): message is SessionMessage.AssistantWithParts =>
      message.role === "assistant",
  );
  const model = reply?.metadata.aiGatewayModel;
  if (
    !reply ||
    !model ||
    reply.metadata.error !== undefined ||
    coldTail(reply.metadata.usage)
  ) {
    return;
  }
  const signal = AbortSignal.timeout(30_000);
  const messages = await prepareModelMessages({
    agent: instrumentAgent,
    chatId,
    model,
    // A request about to roll over or clear is one the cache no longer
    // serves, and recording either is the next turn's to do.
    readOnly: true,
    sessionId,
    signal,
  });
  if (messages.isErr()) {
    return;
  }
  const workspaceConfig = getWorkspaceConfig();
  const aiSDKModel = await fetchAISDKModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelRoutes: workspaceConfig.modelRoutes,
    modelURI: model.uri,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!aiSDKModel.ok) {
    return;
  }
  // The turn's own tools, as definitions: they open the prefix the cache
  // is keyed on, and nothing here runs one.
  const tools: ToolSet = {};
  for (const tool of await instrumentAgent.getTools()) {
    tools[tool.name as string] = await tool.aiSDKTool({ chatId, model });
  }
  const result = await generateText({
    abortSignal: signal,
    allowSystemInMessages: true,
    headers: {
      [CLIENT_SESSION_ID_HEADER]: cacheSessionFor({ chatId, sessionId }),
    },
    maxOutputTokens: SUGGESTION_MAX_OUTPUT_TOKENS,
    messages: [
      ...messages.value,
      {
        content: NEXT_MESSAGE_INSTRUCTION,
        providerOptions: TRANSIENT,
        role: "user",
      } satisfies ModelMessage,
    ],
    model: aiSDKModel.value,
    providerOptions: providerOptionsForModel(aiSDKModel.value, {
      effort: "low",
      reasoning: model.reasoning,
    }),
    telemetry: activityTelemetry({
      chatId,
      connection: connectionFor(
        workspaceConfig.getAIProviderConfigs(),
        model.params.providerConfigId,
      ),
      purpose: "next-message",
      sessionId,
    }),
    tools: mapValues(
      tools,
      ({ execute: _execute, ...definition }) => definition,
    ),
  });
  const text = suggestionFrom(result.text);
  asked.set(chatId, {
    ...(text === undefined ? {} : { suggestion: text }),
    usage: result.totalUsage,
  });
  // A turn that started while the model answered, or a later settle, has
  // moved past the reply this was for.
  if (
    text === undefined ||
    (await chatIsWorking(chatId)) ||
    latestSettle.get(chatId) !== token
  ) {
    return;
  }
  suggestions.set(chatId, text);
  publisher.publish("chat.nextMessage", { id: chatId });
}

/**
 * Whether a line talks about the suggestion rather than being one: a model
 * explaining why it has none ("The conversation just ended on a thanks, so
 * there's no next message to suggest").
 */
function looksLikeCommentary(line: string): boolean {
  return /\b(?:next message|to suggest|suggestion|the person|the user|the conversation)\b/i.test(
    line,
  );
}

/**
 * The line a model's answer suggests, or none: an empty answer, one that says
 * it has none, or one too long for a box to show is no suggestion.
 */
export function suggestionFrom(answer: string): string | undefined {
  const line = answer
    .replaceAll(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, "")
    .trim()
    .split("\n")[0]
    ?.trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .trim();
  if (
    !line ||
    line.length > SUGGESTION_MAX_CHARS ||
    /^\(?(?:none|nothing|empty)\)?\.?$/i.test(line) ||
    looksLikeCommentary(line)
  ) {
    return undefined;
  }
  return line;
}
