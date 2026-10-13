import { fetchModel } from "@instrument-org/ai-gateway";
import { alphabetical } from "radashi";

import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { generateTitleFromUserMessage } from "../generate-title-from-user-message";
import { truncateAtWordBoundary } from "../sanitize-model-text";
import { Store } from "../store";
import { chatModelURI } from "../chat-settings";
import { sessionRole } from "./children";
import { updateSessionTitle } from "../update-session-title";
import { getWorkspaceConfig } from "../workspace-config";
import { chatIsWorking, settleChatTitle } from "./chats";
import { lastAssistantTextIn } from "./latest-session";
import { type ChatId } from "../../schemas/chat-id";

/** How much of the latest reply the title call reads. */
const REPLY_MAX = 600;

/**
 * Names a chat again from its root and its latest reply, and says what it
 * is called now: the new title, the one it already had when the call agreed
 * with it, or nothing when the chat has no reply to be named from or no
 * model to ask. `keep` asks the call to hold on to an agent-given title
 * unless the subject has moved; without it, as on the user's own ask, the
 * call names the chat afresh.
 */
export async function retitleChat({
  id,
  keep = false,
  sessionId,
}: {
  id: ChatId;
  keep?: boolean;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  const messages = await Store.getMessagesWithParts({ sessionId, chatId: id });
  if (messages.isErr()) {
    return undefined;
  }
  const sorted = alphabetical(messages.value, (message) => message.id);
  const root = sorted.find(isRoot);
  // Cut plainly: the note-shaped cut addresses the conversation, and this
  // reply is going to the title model.
  const said = lastAssistantTextIn(sorted);
  const reply =
    said === undefined ? undefined : truncateAtWordBoundary(said, REPLY_MAX);
  if (!root || !reply) {
    return undefined;
  }
  const session = await Store.getSession(sessionId, id);
  if (session.isErr()) {
    return undefined;
  }
  // A placeholder is the ask's own first words, not a name worth keeping.
  const currentTitle =
    keep && !isUntitledChatSessionTitle(session.value.title)
      ? session.value.title
      : undefined;
  const workspaceConfig = getWorkspaceConfig();
  const modelURI = await chatModelURI(id);
  if (!modelURI) {
    return undefined;
  }
  const model = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI,
  });
  if (!model.ok) {
    return undefined;
  }
  const title = await generateTitleFromUserMessage({
    currentTitle,
    message: root,
    model: model.value,
    reply,
    chatId: id,
    workspaceConfig,
  });
  if (title.isErr()) {
    return undefined;
  }
  if (title.value === session.value.title) {
    return title.value;
  }
  // Replaced only while the title is still the one read above: a title that
  // landed meanwhile (the opening call finishing late) is the newer fact.
  await updateSessionTitle({
    expectedCurrentTitle: session.value.title,
    sessionId,
    chatId: id,
    title: title.value,
  });
  return title.value;
}

/**
 * Names a chat once more, when its first exchange has settled.
 *
 * The title is written from the opening message, before anything has been
 * done; by the time the chat's agent and every task it filed have stopped,
 * the work has said what it is about, so the chat is named again from the
 * root and the latest reply. That is the whole of it: a title that kept
 * moving would be one the user loses in the list, so after the first settle,
 * or once the user has named the chat themselves, only the user renames it. A turn that leaves something of
 * the chat's still working (a hand-off, a task's report while another
 * runs) waits for the one that settles it, the same moment a notification
 * treats as news.
 */
export function startChatRetitle(): void {
  void (async () => {
    for await (const payload of publisher.subscribe("session.done")) {
      try {
        await retitleOnSettle(payload);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

function isRoot(
  message: SessionMessage.WithParts,
): message is SessionMessage.UserWithParts {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) => part.type === "text" && part.text.trim() !== "",
    )
  );
}

async function retitleOnSettle({
  id,
  sessionId,
}: {
  id: ChatId;
  sessionId: StoreId.Session;
}): Promise<void> {
  // A task's turn ending names nothing: the chat is named from its own.
  if (sessionRole(id, sessionId) !== "chat") {
    return;
  }
  const chatId = id;
  const session = await Store.getSession(sessionId, chatId);
  if (session.isErr() || session.value.titleSettledAt) {
    return;
  }
  if (await chatIsWorking(chatId)) {
    return;
  }
  const title = await retitleChat({ id: chatId, keep: true, sessionId });
  if (title !== undefined) {
    await settleChatTitle(chatId);
  }
}
