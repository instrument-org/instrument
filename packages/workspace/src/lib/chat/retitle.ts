import { fetchModel } from "@instrument-org/ai-gateway";
import { alphabetical } from "radashi";

import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { askDecisionModel } from "../decision-model";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import {
  generateTitleFromUserMessage,
  titleSourceText,
} from "../generate-title-from-user-message";
import { truncateAtWordBoundary } from "../sanitize-model-text";
import { Store } from "../store";
import { chatModelURI } from "../chat-settings";
import { chatConversation } from "./children";
import { updateSessionTitle } from "../update-session-title";
import { getWorkspaceConfig } from "../workspace-config";
import { chatIsWorking, settleChatTitle } from "./chats";
import { lastAssistantTextIn } from "./latest-session";
import { type ChatId } from "../../schemas/chat-id";

/** How much of the latest reply the title call reads. */
const REPLY_MAX = 600;

/**
 * Below this chance that the subject has moved, an agent-given title is kept
 * without asking the title model. Chats that stayed on their subject came
 * back near 0.07 and chats that moved near 0.75, so 0.3 leaves room on both
 * sides and leans toward asking: a wrong keep leaves a stale title for good,
 * while a wrong ask only spends the call this exists to save.
 */
const MOVED_BELOW = 0.3;

/**
 * Names a chat again from its root and its latest reply, and says what it
 * is called now: the new title, the one it already had when the call agreed
 * with it, or nothing when the chat has no reply to be named from or no
 * model to ask. `keep` asks the call to hold on to an agent-given title
 * unless the subject has moved, and asks the decision model first, so a
 * title it is confident still fits is kept without the call; without `keep`,
 * as on the user's own ask, the call names the chat afresh.
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
  if (
    currentTitle !== undefined &&
    (await titleStillFits({
      ask: askDecisionModel,
      configs: workspaceConfig.getAIProviderConfigs(),
      currentTitle,
      opening: titleSourceText(root),
      reply,
      taskId: id,
    }))
  ) {
    return currentTitle;
  }
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
    taskId: id,
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

/**
 * Whether a title the agent gave still names the chat, asked of the
 * decision model before the title model is: one yes-or-no on whether the
 * subject has moved, a few hundred milliseconds and a fraction of a cent
 * against a full title call. Only a confident no keeps the title. No
 * provider for the decision model, a failure, or an unsure answer all say
 * false, which leaves the title model to decide as it would without this.
 */
export async function titleStillFits({
  ask,
  configs,
  currentTitle,
  opening,
  reply,
  taskId,
}: {
  ask: typeof askDecisionModel;
  configs: Parameters<typeof askDecisionModel>[0]["configs"];
  currentTitle: string;
  opening: string;
  reply: string;
  taskId: TaskId;
}): Promise<boolean> {
  try {
    const asked = await ask({
      body: {
        questions: {
          moved: {
            criteria: {
              false:
                "The title still fits the chat, even if the work narrowed or progressed",
              true: "The title names something the chat has moved on from, or misses what it is now mainly about",
            },
            instructions:
              "Has the conversation's subject moved away from what `current_title` names, so that the title no longer describes it?",
            type: "noul",
          },
        },
        state: {
          current_title: currentTitle,
          latest_reply: reply,
          opening_message: opening,
        },
      },
      configs,
      usage: { purpose: "title-check", taskId },
    });
    const moved = asked?.response.answers.moved?.noul;
    return moved !== undefined && moved < MOVED_BELOW;
  } catch {
    return false;
  }
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
  const chatId = chatConversation(id, sessionId);
  if (!chatId) {
    return;
  }
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
