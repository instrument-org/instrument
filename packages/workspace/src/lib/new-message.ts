import { type AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { extractSkillMentions } from "@instrument-org/shared/skill-mention";
import { ok } from "neverthrow";

import { type FileUpload } from "../schemas/file-upload";
import { type MountedFolder } from "../schemas/mounted-folder";
import { AbsolutePathSchema } from "../schemas/paths";
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
import { createSetupNewsPart } from "./setup-news";
import { readWorkspaceInstructions } from "./workspace-instructions";
import { detectDateChange } from "./date-change";
import { detectEnvironmentChange } from "./environment";
import { ChatReads } from "./chat-reads";
import { detectMessageGap } from "./message-gap";
import { pathExists } from "./path-exists";
import { folderReach } from "./chat/folder-reach";
import { listTopics, type TopicFolder } from "./chat/topics";
import { tabHolders } from "./chat/window-tab";
import { chatDir, resolveChat } from "./record-folders";
import { chatModelURI, setChatModel } from "./chat-settings";
import { grantFile, grantFolder } from "./chat/grants";
import { sessionRole } from "./chat/children";
import { getWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

export async function newMessage({
  asks,
  files,
  folders,
  fromChat,
  fromDraft,
  modelURI,
  prompt,
  replyTo,
  sessionId,
  chatId,
  viewing,
}: {
  /** Places in files the user marked, with what to change at each; see the asks part. */
  asks?: SessionMessageDataPart.AsksDataPart;
  /** Files the user sent with the message, each from the disk granted to the chat where it is. */
  files?: FileUpload.Type[];
  /** Folders the user sent with the message, each granted to the chat. */
  folders?: { path: string }[];
  /**
   * Words the chat wrote to this task, in place of a prompt; see the
   * from-chat part.
   */
  fromChat?: SessionMessageDataPart.FromChatDataPart;
  /** The draft this was sent from, by its id; see the message's metadata. */
  fromDraft?: string;
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
  const workspaceInstructions = await readWorkspaceInstructions();
  if (workspaceInstructions) {
    parts.push({
      data: workspaceInstructions,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-workspaceInstructions",
    });
  }
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

  if (viewing) {
    parts.push({
      data: withAgentPaths(await withTabHolders(chatId, viewing)),
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

  if ((files && files.length > 0) || (folders && folders.length > 0)) {
    const uploadResult = await writeUploadedAttachments({
      files,
      messageId,
      recordDir: chatDir(chatId),
      sessionId,
    });

    if (uploadResult.isErr()) {
      return uploadResult;
    }

    for (const file of files ?? []) {
      if ("path" in file) {
        await grantFile({ chatId, path: file.path });
      }
    }
    for (const folder of folders ?? []) {
      await grantAttachedFolder(chatId, folder.path);
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

  const isChat = sessionRole(chatId, sessionId) === "chat";
  // The tabs the session holds, the chat's own conversation included: the
  // tabs it opened itself and those no task drives.
  const browserStatusPart = await createBrowserStatusPart({
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

  // The session context names the computer it started on and is never
  // rewritten, so a chat that moved to another computer, or whose computer
  // changed under it, is told here instead.
  // The chat's model as of this message: the one the composer sent with,
  // which picks it, or for a task the chat's.
  const environmentChange = await detectEnvironmentChange({
    chatId,
    messageId,
    runsOn: isChat ? modelURI : await chatModelURI(chatId),
    sessionId,
  });
  if (environmentChange.isErr()) {
    // Awareness of the computer is best-effort; never block sending.
    getWorkspaceConfig().captureException(environmentChange.error);
  } else if (environmentChange.value) {
    parts.push(environmentChange.value);
  }

  // Nothing in the context says what time it is, so a message sent a day after
  // the one before it is otherwise indistinguishable from one sent a moment
  // later.
  //
  // Only where a person is the one who went quiet. A task's messages come from
  // the chat by way of `instrument task send`, so the same gap there measures how
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

    // The chat's topic, or none, rides on every message sent in it; see the
    // `state` cadence for what the model hears of it.
    const topicPart = await createTopicPart({
      createdAt,
      messageId,
      sessionId,
      chatId,
    });
    if (topicPart) {
      parts.push(topicPart);
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

    // Skills and apps another chat, the person or a program changed since
    // this session last heard: its catalog and app list were written when it
    // began.
    const setupNews = await createSetupNewsPart({
      createdAt,
      messageId,
      sessionId,
      chatId,
    });
    if (setupNews) {
      parts.push(setupNews);
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
    metadata: {
      createdAt,
      ...(fromDraft ? { fromDraft } : {}),
      sessionId,
    },
    parts,
    role: "user",
  };

  // The composer sending is what picks the chat's model; a task's message
  // runs on the chat's and picks nothing.
  if (isChat) {
    const picked = await setChatModel(chatId, modelURI);
    if (picked.isErr()) {
      return picked;
    }
  }

  return ok(message);
}

/**
 * Grants the chat a folder the person attached to a message, on this
 * computer: attaching one with the folder picker, or dropping it in, says
 * where the work is and opens it to the chat. A folder in a chip over the
 * words (`viewContext.chosen`, or the one a screen in view shows) is a hint,
 * which the agent still asks for.
 * A path not on this disk, such as one a draft synced from another computer
 * names, grants nothing.
 */
async function grantAttachedFolder(chatId: ChatId, folderPath: string) {
  const parsed = AbsolutePathSchema.safeParse(folderPath);
  if (parsed.success && (await pathExists(parsed.data))) {
    await grantFolder({ chatId, path: parsed.data, source: "attached" });
  }
}

/** The topic the chat is filed under, named for the model, or null for none. */
async function createTopicPart({
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
  const session = await ChatReads.session({ chatId, sessionId });
  if (session.isErr()) {
    return undefined;
  }
  const known = await listTopics();
  const filed = known.find((entry) => entry.id === session.value.topic);
  const folders = filed
    ? topicFolderPaths(await folderReach(chatId), filed.folders ?? [])
    : [];
  return {
    data: {
      topic: filed
        ? {
            ...(filed.about ? { about: filed.about } : {}),
            ...(filed.emoji ? { emoji: filed.emoji } : {}),
            ...(folders.length > 0 ? { folders } : {}),
            ...(filed.instructions ? { instructions: filed.instructions } : {}),
            name: filed.name,
          }
        : null,
    },
    metadata: { createdAt, id: StoreId.newPartId(), messageId, sessionId },
    type: "data-topic",
  };
}

/**
 * The path of each of a topic's folders the chat reaches. A folder no longer
 * on disk is not reached, and is left out so the agent is not pointed at
 * nothing.
 */
function topicFolderPaths(
  reach: Record<string, MountedFolder.Type>,
  folders: TopicFolder[],
): string[] {
  return folders.flatMap((folder) => {
    const reached = Object.values(reach).find(
      (entry) => entry.path === folder.path,
    );
    return reached ? [shellPath(reached.path)] : [];
  });
}

/**
 * What the user had on screen, with each file and folder it names also as
 * the agent's shell spells it on this computer: stored with the message, so
 * the note says the same thing wherever the chat is read later.
 */
function withAgentPaths(
  viewing: SessionMessageDataPart.ViewContextDataPart,
): SessionMessageDataPart.ViewContextDataPart {
  return {
    ...viewing,
    ...(viewing.chosen && {
      chosen: viewing.chosen.map((entry) => ({
        ...entry,
        agentPath: shellPath(entry.path),
      })),
    }),
    ...(viewing.file && {
      file: { ...viewing.file, agentPath: shellPath(viewing.file.path) },
    }),
  };
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
