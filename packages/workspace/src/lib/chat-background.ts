import { type ChatId } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { listTopics } from "./chat/topics";
import { memoryNoteRow } from "./create-memory-part";
import { listMemories, memoryDir } from "./memory/store";
import { Store } from "./store";

/** How many memories the background lists. */
const MEMORIES_IN_BACKGROUND = 64;

/**
 * How much of the user's own words the background carries, newest kept: a
 * long chat's small talk is not worth a task's whole context.
 */
const USER_WORDS_MAX_CHARS = 20_000;

/**
 * What a task started by a chat is given of the chat beside its brief, under
 * the `task_context` flag (arm E of the hand-off comparison): the user's own
 * messages there, verbatim, that the task has not been given yet, and, with
 * `standing`, the chat's topic instructions and what memory holds, which a
 * chat is told and a task otherwise never is. None when there is nothing to
 * give.
 */
export async function chatBackground({
  chatId,
  chatSessionId,
  standing,
  taskId,
}: {
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  /** On the task's first message: the topics and memories as well. */
  standing: boolean;
  /** The task, once it exists, whose earlier backgrounds are not repeated. */
  taskId?: TaskId;
}): Promise<SessionMessageDataPart.ChatBackgroundDataPart | undefined> {
  const chat = await Store.getMessagesWithParts({
    sessionId: chatSessionId,
    taskId: chatId,
  });
  const given = taskId ? await forwardedTo(taskId) : new Set<string>();
  const messages = newestWithin(
    (chat.isOk() ? chat.value : []).flatMap((message) => {
      const text = typedText(message);
      return text && !given.has(message.id)
        ? [
            {
              id: message.id,
              sentAt: message.metadata.createdAt.getTime(),
              text,
            },
          ]
        : [];
    }),
  );

  const topics = standing ? await chatTopics(chatId, chatSessionId) : [];
  const memories = standing
    ? (await listMemories(memoryDir()))
        .slice(0, MEMORIES_IN_BACKGROUND)
        .map(memoryNoteRow)
    : [];

  if (messages.length === 0 && topics.length === 0 && memories.length === 0) {
    return undefined;
  }
  return {
    ...(memories.length > 0 ? { memories } : {}),
    messages,
    ...(topics.length > 0 ? { topics } : {}),
  };
}

/** The chat's topics that carry instructions, as the chat itself is told them. */
async function chatTopics(chatId: ChatId, chatSessionId: StoreId.Session) {
  const session = await Store.getSession(chatSessionId, chatId);
  const tagged = session.isOk() ? (session.value.topics ?? []) : [];
  if (tagged.length === 0) {
    return [];
  }
  const known = await listTopics();
  return tagged.flatMap((id) => {
    const topic = known.find((entry) => entry.id === id);
    return topic?.instructions
      ? [{ instructions: topic.instructions, name: topic.name }]
      : [];
  });
}

/** The chat messages a task's earlier backgrounds already carried. */
async function forwardedTo(taskId: TaskId): Promise<Set<string>> {
  const sessions = await Store.getSessions(taskId);
  const ids = new Set<string>();
  for (const session of sessions.isOk() ? sessions.value : []) {
    const messages = await Store.getMessagesWithParts({
      sessionId: session.id,
      taskId,
    });
    for (const message of messages.isOk() ? messages.value : []) {
      for (const part of message.parts) {
        if (part.type === "data-chatBackground") {
          for (const forwarded of part.data.messages) {
            ids.add(forwarded.id);
          }
        }
      }
    }
  }
  return ids;
}

/** The newest messages whose text fits the budget, oldest first. */
function newestWithin<T extends { text: string }>(messages: T[]): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (const message of messages.toReversed()) {
    chars += message.text.length;
    if (chars > USER_WORDS_MAX_CHARS && kept.length > 0) {
      break;
    }
    kept.unshift(message);
  }
  return kept;
}

/**
 * What the user typed in a chat message: its text, or nothing for a note the
 * app put in the chat (a task's report, an app's event that woke it) and for
 * a message with no words in it.
 */
function typedText(message: SessionMessage.WithParts): string | undefined {
  if (
    message.role !== "user" ||
    message.parts.some(
      (part) =>
        part.type === "data-taskEvent" ||
        (part.type === "data-appEvent" && !part.data.carried),
    )
  ) {
    return undefined;
  }
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  return text || undefined;
}
