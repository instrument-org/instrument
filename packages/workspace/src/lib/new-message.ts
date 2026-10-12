import { type AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { extractSkillMentions } from "@instrument-org/shared/skill-mention";
import { ok } from "neverthrow";

import { MOUNT } from "../mount-points";
import { type FileUpload } from "../schemas/file-upload";
import { type MountedFolder } from "../schemas/mounted-folder";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { detectFolderChanges } from "./folder-changes";
import { detectChatAppChanges } from "./chat-app-changes";
import { createBackgroundProcessesPart } from "./create-background-processes-part";
import { createBrowserStatusPart } from "./create-browser-status-part";
import { createMemoryPart } from "./create-memory-part";
import { detectDateChange } from "./date-change";

import { detectMessageGap } from "./message-gap";
import { folderReach } from "./chat/folder-reach";
import { listTopics, type TopicFolder } from "./chat/topics";
import { tabHolders } from "./chat/window-tab";
import { Store } from "./store";
import { resolveChat } from "./record-folders";
import { updateChatSettings } from "./chat-settings";
import { grantFolder } from "./chat/grants";
import { chatConversation } from "./chat/children";
import { getWorkspaceConfig } from "./workspace-config";
import { writeUploadedAttachments } from "./write-uploaded-attachments";
import { workDir } from "./work-dir";

export async function newMessage({
  asks,
  files,
  folders,
  fromChat,
  intent,
  modelURI,
  prompt,
  replyTo,
  sessionId,
  chatId,
  viewing,
}: {
  /** Places in files the user marked, with what to change at each; see the asks part. */
  asks?: SessionMessageDataPart.AsksDataPart;
  files?: FileUpload.Type[];
  /** Folders the user sent with the message, each granted to the chat. */
  folders?: { path: string }[];
  /**
   * Words the chat wrote to this task, in place of a prompt; see the
   * from-chat part.
   */
  fromChat?: SessionMessageDataPart.FromChatDataPart;
  intent?: string;
  modelURI: AIGatewayModelURI.Type;
  prompt: string;
  /** The earlier message this one answers; see the reply part. */
  replyTo?: SessionMessageDataPart.ReplyDataPart;
  sessionId: StoreId.Session;
  chatId: ChatId;
  /** What the sending surface had on screen; see the view-context part. */
  viewing?: SessionMessageDataPart.ViewContextDataPart;
}) {
  const messageId = StoreId.newMessageId();
  const createdAt = new Date();
  const parts: SessionMessagePart.Type[] = [];
  if (prompt.trim()) {
    parts.push({
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      text: prompt.trim(),
      type: "text",
    });
  }

  if (fromChat) {
    parts.push({
      data: fromChat,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-fromChat",
    });
  }

  const mentionedSkills = extractSkillMentions(prompt);
  if (mentionedSkills.length > 0) {
    parts.push({
      data: { names: mentionedSkills },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-skillMentions",
    });
  }

  if (intent?.trim()) {
    parts.push({
      data: { text: intent.trim() },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-intent",
    });
  }

  if (viewing) {
    parts.push({
      data: await withTabHolders(chatId, viewing),
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-viewContext",
    });
  }

  if (asks) {
    parts.push({
      data: asks,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-asks",
    });
  }

  if (replyTo) {
    parts.push({
      data: replyTo,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-reply",
    });
  }

  for (const folder of folders ?? []) {
    await grantFolder({ chatId, path: folder.path, source: "attached" });
  }

  if ((files && files.length > 0) || (folders && folders.length > 0)) {
    const uploadResult = await writeUploadedAttachments({
      dir: workDir(chatId),
      files,
      messageId,
      sessionId,
    });

    if (uploadResult.isErr()) {
      return uploadResult;
    }

    const { part } = uploadResult.value;
    parts.push(
      part.type === "data-attachments" && folders && folders.length > 0
        ? {
            ...part,
            data: {
              ...part.data,
              folders: folders.map((folder) => ({ path: folder.path })),
            },
          }
        : part,
    );
  }

  const backgroundProcessesPart = await createBackgroundProcessesPart({
    createdAt,
    messageId,
    sessionId,
    chatId,
  });
  if (backgroundProcessesPart) {
    parts.push(backgroundProcessesPart);
  }

  // A chat has no browser of its own: it drives whichever of the
  // window's tabs is on screen, which the view note on each message names,
  // so the open-and-closed bookkeeping of a task's browser would only tell
  // it tales about tabs it never owned. A task of the chat's, in the same
  // store, is told as a task.
  const isChat = chatConversation(chatId, sessionId) !== undefined;
  const browserStatusPart = isChat
    ? undefined
    : await createBrowserStatusPart({
        createdAt,
        messageId,
        sessionId,
        chatId,
      });
  if (browserStatusPart) {
    parts.push(browserStatusPart);
  }

  // The session context states the date the session started and is never
  // rewritten, so a session that ran overnight is corrected here instead.
  const dateChange = await detectDateChange({ messageId, sessionId, chatId });
  if (dateChange.isErr()) {
    // Awareness of the date is best-effort; never block sending.
    getWorkspaceConfig().captureException(dateChange.error);
  } else if (dateChange.value) {
    parts.push(dateChange.value);
  }

  // Nothing in the context says what time it is, so a message sent a day after
  // the one before it is otherwise indistinguishable from one sent a moment
  // later.
  //
  // Only where a person is the one who went quiet. A task's messages come from
  // the chat by way of `task send`, so the same gap there measures how
  // long the app took to say something back, which is neither the task's to
  // reason about nor what its instructions tell it to do with the answer.
  if (isChat) {
    const messageGap = await detectMessageGap({
      messageId,
      sentAt: createdAt,
      sessionId,
      chatId,
    });
    if (messageGap.isErr()) {
      // Awareness of the gap is best-effort; never block sending.
      getWorkspaceConfig().captureException(messageGap.error);
    } else if (messageGap.value) {
      parts.push(messageGap.value);
    }

    // The chat's topics ride on every message sent in it, and the model
    // note is rendered only when they changed since the last one.
    const chatTopicsPart = await createChatTopicsPart({
      createdAt,
      messageId,
      sessionId,
      chatId,
    });
    if (chatTopicsPart) {
      parts.push(chatTopicsPart);
    }

    // What the agent remembers about the user, told once and again only when
    // it changed since: another chat saved something, or the user forgot one.
    const memoryPart = await createMemoryPart({
      createdAt,
      messageId,
      sessionId,
      chatId,
    });
    if (memoryPart) {
      parts.push(memoryPart);
    }
  }

  // A chat's apps are listed in its session context, written once; one
  // connected, disconnected, or removed since arrives on this message.
  if (isChat) {
    const chatAppChanges = await detectChatAppChanges({
      messageId,
      sessionId,
      chatId,
    });
    if (chatAppChanges.isErr()) {
      getWorkspaceConfig().captureException(chatAppChanges.error);
    } else if (chatAppChanges.value) {
      parts.push(chatAppChanges.value);
    }
  }

  // Notify agent of folders added, removed, or renamed since last turn
  // (per-session baseline diff). Runs after the grants above, so a folder
  // sent with this message is told here, under the name it mounts at.
  const folderChanges = await detectFolderChanges({
    messageId,
    sessionId,
    chatId,
  });
  if (folderChanges.isErr()) {
    // Awareness of folder changes is best-effort; never block sending.
    getWorkspaceConfig().captureException(folderChanges.error);
  } else if (folderChanges.value) {
    parts.push(folderChanges.value);
  }

  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts,
    role: "user",
  };

  // The composer sending is what picks the chat's model; a task's message
  // runs on the chat's and picks nothing.
  if (isChat) {
    const picked = await updateChatSettings(chatId, { modelURI });
    if (picked.isErr()) {
      return picked;
    }
  }

  return ok(message);
}

/**
 * The topics the chat carries, named for the model. None when it carries
 * none and never has: a chat untagged since its last message gets an empty
 * part, so the note can say the topics are gone.
 */
async function createChatTopicsPart({
  createdAt,
  messageId,
  sessionId,
  chatId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<SessionMessagePart.Type | undefined> {
  const session = await Store.getSession(sessionId, chatId);
  if (session.isErr()) {
    return undefined;
  }
  const tagged = session.value.topics ?? [];
  if (tagged.length === 0) {
    const messages = await Store.getMessagesWithParts({ sessionId, chatId });
    const toldBefore =
      messages.isOk() &&
      messages.value.some((message) =>
        message.parts.some((part) => part.type === "data-chatTopics"),
      );
    if (!toldBefore) {
      return undefined;
    }
  }
  const known = await listTopics();
  const reach = await folderReach(chatId);
  const topics = [];
  for (const id of tagged) {
    const topic = known.find((entry) => entry.id === id);
    if (!topic) {
      continue;
    }
    const folders = topicFolderMounts(reach, topic.folders ?? []);
    topics.push({
      ...(topic.about ? { about: topic.about } : {}),
      ...(topic.emoji ? { emoji: topic.emoji } : {}),
      ...(folders.length > 0 ? { folders } : {}),
      ...(topic.instructions ? { instructions: topic.instructions } : {}),
      name: topic.name,
    });
  }
  return {
    data: { topics },
    metadata: { createdAt, id: StoreId.newPartId(), messageId, sessionId },
    type: "data-chatTopics",
  };
}

/**
 * Where each of a topic's folders is mounted in the chat, by the chat's
 * reach. A folder no longer on disk is in no mount, and is left out so the
 * agent is not pointed at nothing.
 */
function topicFolderMounts(
  reach: Record<string, MountedFolder.Type>,
  folders: TopicFolder[],
): string[] {
  return folders.flatMap((folder) => {
    const mounted = Object.values(reach).find(
      (entry) => entry.path === folder.path,
    );
    return mounted ? [`${MOUNT.folders}/${mounted.mountName}`] : [];
  });
}

/**
 * The note on what the user had on screen, with each tab marked with the task
 * at work in it: read when the message is stored, since the note is rendered
 * from what is stored and must say the same thing every time it is read.
 */
async function withTabHolders(
  chatId: ChatId,
  viewing: SessionMessageDataPart.ViewContextDataPart,
): Promise<SessionMessageDataPart.ViewContextDataPart> {
  if (!viewing.tabs?.length && !viewing.page?.tabs?.length) {
    return viewing;
  }
  if (!resolveChat(chatId)) {
    return viewing;
  }
  const holders = await tabHolders(chatId);
  if (holders.size === 0) {
    return viewing;
  }
  const mark = <Tab extends { id?: string }>(tab: Tab) => {
    const holder = tab.id === undefined ? undefined : holders.get(tab.id);
    return holder ? { ...tab, heldBy: holder } : tab;
  };
  return {
    ...viewing,
    ...(viewing.tabs ? { tabs: viewing.tabs.map(mark) } : {}),
    ...(viewing.page
      ? {
          page: {
            ...viewing.page,
            ...(viewing.page.tabs ? { tabs: viewing.page.tabs.map(mark) } : {}),
          },
        }
      : {}),
  };
}
