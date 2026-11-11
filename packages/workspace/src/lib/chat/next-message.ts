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
import { withoutInlineThinking } from "../without-inline-thinking";
import { openAsksUntil } from "./open-asks";

/**
 * The instruction the suggestions are asked with, after the chat's own
 * conversation: up to three messages the person might send next, or nothing.
 */
const NEXT_MESSAGE_INSTRUCTION = `This message is from ${APP_NAME}, not the person, and they will not see it. Don't reply to them or use any tool.

Suggest what the person might send next: usually one message, three at most, one per line, the likeliest first. They appear under the agent's reply, and the person sends one with a press.

Predict what they would type next, in their own words. The test for each line: would they think "I was just about to type that"?

- Start from one line, the message they'd most likely send. Stop there unless another clears the same test.
- Add a second or third only for a different thing they'd just as plainly want, never the same idea reworded, a variation on the first ("as a Word doc"), or a way to start over.
- Fewer is always fine. One good line beats three with a filler.

- Write it as the person, to the agent. Never in the agent's voice ("Let me…", "I'll…").
- Specific beats generic: "Summarize the two you found" beats "Continue".
- When the agent offered options, suggest the ones the person would most likely take, in their words.
- When the agent asked whether to do something ("Want me to save it as a file?"), give only the answer they would most likely give: "Yes, save it".
- A question is fine when it's the obvious next thing to ask about the answer they just got.
- Only what follows from what they asked for. No new ideas, no upselling, and nothing that takes their work somewhere they didn't mention (publishing, sharing, another app).
- Never suggest deleting, sending, buying, posting, or anything else that can't be undone, unless the person already said they want it done.
- 2 to 10 words each. Match how the person writes: their casing, punctuation and tone.

Answer with exactly NONE only when:
- the agent's last message asks something only the person can answer, even in passing ("How's the new phone?", "Which city?"), or is waiting on a card (a permission, a sign-in, a choice): they answer that themselves;
- something failed or the agent is still working;
- the person just said thanks or goodbye;
- it touches something sensitive: passwords or keys, a security incident, harm to anyone, health, or someone's private life.

Otherwise suggest. A finished answer still gets one line: the follow-up they would most likely ask for next.

Reply with only the lines or NONE: no numbering, bullets, quotes or explanation.`;

/** Room for a low-effort model's thinking and the lines after it. */
const SUGGESTION_MAX_OUTPUT_TOKENS = 1024;

/** The longest suggestion kept: past this it is not a line a row shows. */
const SUGGESTION_MAX_CHARS = 120;

/** The most suggestions shown under a reply. */
const SUGGESTIONS_MAX = 3;

/** What this computer suggested each chat's person send next, likeliest first. */
const suggestions = new Map<ChatId, readonly string[]>();

/** Each chat's latest settle, so an ask a later settle overtook says nothing. */
const latestSettle = new Map<ChatId, symbol>();

/** What each chat's last ask answered and what it cost, for evals to read. */
const asked = new Map<
  ChatId,
  { answer: string; suggestions: readonly string[]; usage: LanguageModelUsage }
>();

/**
 * How many windows show each chat's box, by the suggestion streams open on
 * it; `EVERY_CHAT` counts one that shows them all.
 */
const watchers = new Map<ChatId | typeof EVERY_CHAT, number>();
const EVERY_CHAT = Symbol("every chat");

/**
 * Counts a window showing the chat's box (every chat's, with none named, as
 * an eval stands in for one) until the returned call takes it away. A chat
 * no window shows is asked nothing: its suggestion would go unseen.
 */
export function watchNextMessage(chatId?: ChatId): () => void {
  const key = chatId ?? EVERY_CHAT;
  watchers.set(key, (watchers.get(key) ?? 0) + 1);
  return () => {
    const left = (watchers.get(key) ?? 1) - 1;
    if (left > 0) {
      watchers.set(key, left);
    } else {
      watchers.delete(key);
    }
  };
}

function watched(chatId: ChatId): boolean {
  return watchers.has(chatId) || watchers.has(EVERY_CHAT);
}

/** Whether the person lets chats suggest a next message, read fresh each time. */
function maySuggest(): boolean {
  return getWorkspaceConfig().maySuggestNextMessage?.() ?? true;
}

/** What the chat's last ask for a next message answered, and its usage; none before one finished. */
export function lastNextMessageAsk(chatId: ChatId) {
  return asked.get(chatId);
}

/**
 * The suggestions standing for the chat, or none once it is working again:
 * a message sent, or anything of its started, ends the moment they were for.
 */
export async function chatNextMessages(
  chatId: ChatId,
): Promise<readonly string[]> {
  const standing = suggestions.get(chatId);
  if (!standing || !maySuggest()) {
    return [];
  }
  if (await chatIsWorking(chatId)) {
    suggestions.delete(chatId);
    return [];
  }
  return standing;
}

/**
 * Suggests the person's next messages each time a chat settles, on the model
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
      // Whatever stood was for the turn before this one, asked for or not.
      if (suggestions.delete(settle.id)) {
        publisher.publish("chat.nextMessage", { id: settle.id });
      }
      if (settle.by !== undefined || !maySuggest() || !watched(settle.id)) {
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
  if (!reply || !model || reply.metadata.error !== undefined) {
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
  const lines = suggestionsFrom(result.text);
  asked.set(chatId, {
    answer: result.text,
    suggestions: lines,
    usage: result.totalUsage,
  });
  // A turn that started while the model answered, or a later settle, has
  // moved past the reply this was for.
  if (
    lines.length === 0 ||
    (await chatIsWorking(chatId)) ||
    latestSettle.get(chatId) !== token
  ) {
    return;
  }
  suggestions.set(chatId, lines);
  publisher.publish("chat.nextMessage", { id: chatId });
}

/**
 * Whether a line talks about the suggestions rather than being one: a model
 * explaining why it has none ("The conversation just ended on a thanks, so
 * there's no next message to suggest"), or giving its reason on a line after
 * one ("because they asked for three").
 */
function looksLikeCommentary(line: string): boolean {
  return (
    /\b(?:next message|to suggest|suggestion|the person|the user|the conversation)\b/i.test(
      line,
    ) || /^(?:because|since|reason|note)\b/i.test(line)
  );
}

/**
 * Whether a line is not something the person would send: punctuation with no
 * word in it ("????"), praise alone ("Looks good"), the agent's voice ("Let
 * me…"), or Markdown. "Sure, save
 * it" and "Yes. Save it" are the person answering an offer, so neither a
 * "sure" nor a second sentence rules one out.
 */
function looksUnsendable(line: string): boolean {
  return (
    !/[\p{L}\p{N}]/u.test(line) ||
    /^(?:thanks|thank you|looks good|sounds good|great|perfect|nice|makes sense)\b[\s!.]*$/i.test(
      line,
    ) ||
    /^(?:let me|i'll|i will|i've|i'm|here's|here is|you should)\b/i.test(
      line,
    ) ||
    /[*#]/.test(line)
  );
}

/**
 * The lines a model's answer suggests, likeliest first, or none: an empty
 * answer or one that says it has none suggests nothing, and a line too long
 * for a row to show, one the person would not send, or one already given is
 * left out. Numbering, a bullet, a label or tags around a line are taken off.
 */
export function suggestionsFrom(answer: string): string[] {
  const lines: string[] = [];
  for (const raw of withoutInlineThinking(answer)
    .replaceAll(/<\/?suggestions?>/gi, "")
    .split("\n")) {
    const line = raw
      .trim()
      .replace(/^(?:[-•]|\d+[.)])\s+/, "")
      .replace(
        /^(?:suggestion|suggested message|next message|reply)\s*:\s*/i,
        "",
      )
      .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
      .trim();
    if (
      !line ||
      line.length > SUGGESTION_MAX_CHARS ||
      /^\(?(?:none|nothing|empty)\)?\.?$/i.test(line) ||
      looksLikeCommentary(line) ||
      looksUnsendable(line) ||
      lines.some((kept) => kept.toLowerCase() === line.toLowerCase())
    ) {
      continue;
    }
    lines.push(line);
  }
  return lines.slice(0, SUGGESTIONS_MAX);
}
