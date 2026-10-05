import { type AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { extractSkillMentions } from "@instrument-org/shared/skill-mention";
import { ok } from "neverthrow";

import { MOUNT } from "../mount-points";
import { type FileUpload } from "../schemas/file-upload";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { detectAttachedFolderChanges } from "./attached-folder-changes";
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
import { detectTaskAppChanges } from "./task-app-changes";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-record";
import { resolveChat } from "./record-folders";
import { getWorkspaceConfig } from "./workspace-config";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

export async function newMessage({
  asks,
  chatContext,
  files,
  folders,
  intent,
  modelURI,
  output,
  prompt,
  replyTo,
  sessionId,
  taskId,
  viewing,
}: {
  /** Places in files the user marked, with what to change at each; see the asks part. */
  asks?: SessionMessageDataPart.AsksDataPart;
  /** The user's other chats, on the message that opens a new one; see the chat-context part. */
  chatContext?: SessionMessageDataPart.ChatContextDataPart;
  files?: FileUpload.Type[];
  /**
   * Folders to grant the task, each at the access and under the mount name
   * given, where given; see grant-folders.ts.
   */
  folders?: {
    access?: FolderAttachment.Access;
    mountName?: string;
    path: string;
    source?: FolderAttachment.Source;
  }[];
  intent?: string;
  modelURI: AIGatewayModelURI.Type;
  /** The kind of page the user asked for the response as; see the output-format part. */
  output?: SessionMessageDataPart.OutputFormatDataPart;
  prompt: string;
  /** The earlier message this one answers; see the reply part. */
  replyTo?: SessionMessageDataPart.ReplyDataPart;
  sessionId: StoreId.Session;
  taskId: TaskId;
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
      data: await withTabHolders(taskId, viewing),
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

  if (output) {
    parts.push({
      data: output,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-outputFormat",
    });
  }

  if ((files && files.length > 0) || (folders && folders.length > 0)) {
    const uploadResult = await writeUploadedAttachments({
      dir: taskDir(taskId),
      files,
      folders,
      messageId,
      sessionId,
    });

    if (uploadResult.isErr()) {
      return uploadResult;
    }

    parts.push(await namedByReach(taskId, uploadResult.value.part));
  }

  if (chatContext) {
    parts.push({
      data: chatContext,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-chatContext",
    });
  }

  const backgroundProcessesPart = await createBackgroundProcessesPart({
    createdAt,
    messageId,
    sessionId,
    taskId,
  });
  if (backgroundProcessesPart) {
    parts.push(backgroundProcessesPart);
  }

  // A chat has no browser of its own: it drives whichever of the
  // window's tabs is on screen, which the view note on each message names,
  // so the open-and-closed bookkeeping of a task's browser would only tell
  // it tales about tabs it never owned.
  const isChat = resolveChat(taskId) !== undefined;
  const browserStatusPart = isChat
    ? undefined
    : await createBrowserStatusPart({
        createdAt,
        messageId,
        sessionId,
        taskId,
      });
  if (browserStatusPart) {
    parts.push(browserStatusPart);
  }

  // The session context states the date the session started and is never
  // rewritten, so a session that ran overnight is corrected here instead.
  const dateChange = await detectDateChange({ messageId, sessionId, taskId });
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
      taskId,
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
      taskId,
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
      taskId,
    });
    if (memoryPart) {
      parts.push(memoryPart);
    }
  }

  // The apps a task may reach are named in the session context, which is never
  // rewritten, so an app handed over after it started arrives here or nowhere.
  const appChanges = await detectTaskAppChanges({
    messageId,
    sessionId,
    taskId,
  });
  if (appChanges.isErr()) {
    // Awareness of app changes is best-effort; never block sending.
    getWorkspaceConfig().captureException(appChanges.error);
  } else if (appChanges.value) {
    parts.push(appChanges.value);
  }

  // A chat's apps are listed in its session context, written once; one
  // connected, disconnected, or removed since arrives on this message.
  if (isChat) {
    const chatAppChanges = await detectChatAppChanges({
      messageId,
      sessionId,
      taskId,
    });
    if (chatAppChanges.isErr()) {
      getWorkspaceConfig().captureException(chatAppChanges.error);
    } else if (chatAppChanges.value) {
      parts.push(chatAppChanges.value);
    }
  }

  // Notify agent of folders added, removed, or renamed since last turn
  // (per-session baseline diff). Runs after writeUploadedAttachments above so a
  // rename it triggers is read as part of "current" and reported now instead of
  // lagging a turn behind, and so the folders this message attaches can be
  // named here as already announced.
  const folderChanges = await detectAttachedFolderChanges({
    announced: folders?.map((folder) => folder.path) ?? [],
    messageId,
    sessionId,
    taskId,
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

  await setTaskState(taskDir(taskId), { selectedModelURI: modelURI });

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
  taskId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<SessionMessagePart.Type | undefined> {
  const session = await Store.getSession(sessionId, taskId);
  if (session.isErr()) {
    return undefined;
  }
  const tagged = session.value.topics ?? [];
  if (tagged.length === 0) {
    const messages = await Store.getMessagesWithParts({ sessionId, taskId });
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
  const reach = await folderReach(taskId);
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
 * The attachments part with each folder named the way the agent reaches it. A
 * chat mounts its sent folders beside the ones it reaches without holding
 * (folder-reach.ts), and a namesake there can move one to a qualified name.
 */
async function namedByReach(
  taskId: TaskId,
  part: SessionMessagePart.Type,
): Promise<SessionMessagePart.Type> {
  if (part.type !== "data-attachments" || !part.data.folders) {
    return part;
  }
  const reach = Object.values(await folderReach(taskId));
  return {
    ...part,
    data: {
      ...part.data,
      folders: part.data.folders.map((folder) => ({
        ...folder,
        mountName:
          reach.find((entry) => entry.path === folder.path)?.mountName ??
          folder.mountName,
      })),
    },
  };
}

/**
 * Where each of a topic's folders is mounted in the chat, by the chat's
 * reach. A folder no longer on disk is in no mount, and is left out so the
 * agent is not pointed at nothing.
 */
function topicFolderMounts(
  reach: Record<string, FolderAttachment.Type>,
  folders: TopicFolder[],
): string[] {
  return folders.flatMap((folder) => {
    const mounted = Object.values(reach).find(
      (entry) => entry.path === folder.path,
    );
    return mounted ? [`${MOUNT.attachedFolders}/${mounted.mountName}`] : [];
  });
}

/**
 * The note on what the user had on screen, with each tab marked with the task
 * at work in it: read when the message is stored, since the note is rendered
 * from what is stored and must say the same thing every time it is read.
 */
async function withTabHolders(
  taskId: TaskId,
  viewing: SessionMessageDataPart.ViewContextDataPart,
): Promise<SessionMessageDataPart.ViewContextDataPart> {
  if (!viewing.tabs?.length && !viewing.page?.tabs?.length) {
    return viewing;
  }
  const chatId = resolveChat(taskId);
  if (!chatId) {
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
