import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";

import { type WorkspaceActorRef } from "../../src/machines/workspace";
import { ensureChat } from "../../src/lib/chat/chat-records";
import { addChildTask } from "../../src/lib/chat/children";
import { grantFolder } from "../../src/lib/chat/grants";
import { renameChat } from "../../src/lib/chat/chats";
import { newMessage } from "../../src/lib/new-message";
import { ChatReads } from "../../src/lib/chat-reads";
import { ChatWrites } from "../../src/lib/chat-writes";
import { updateChatSettings } from "../../src/lib/chat-settings";
import { type FileUpload } from "../../src/schemas/file-upload";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { StoreId } from "../../src/schemas/store-id";
import { type ChatId } from "../../src/schemas/chat-id";
import { type WorkspaceConfig } from "../../src/types";

/**
 * Starts one eval run the way the product starts the agent it measures.
 *
 * A chat case opens a chat with the prompt, as the window's first send does.
 * A task case makes a chat and a task in it, a session of the chat's started
 * from its empty conversation, then sends the prompt to the task, as `task
 * new` does: the agent answers in a task a chat owns, the only kind the
 * product makes, without spending a chat turn to get there. That chat is
 * never written in, so it is never woken when the task finishes.
 */
export async function startRun(
  {
    apps,
    files,
    folders,
    kind,
    modelURI,
    name,
    prompt,
    viewing,
  }: {
    /** The apps a task case reaches through the `app` command, by slug. */
    apps?: string[];
    files?: FileUpload.Type[];
    folders?: { path: string }[];
    kind: "chat" | "task";
    modelURI: string;
    name: string;
    prompt: string;
    /** What the window had on screen, as the note on the first message. */
    viewing?: SessionMessageDataPart.ViewContextDataPart;
  },
  {
    workspaceConfig,
    workspaceRef,
  }: { workspaceConfig: WorkspaceConfig; workspaceRef: WorkspaceActorRef },
): Promise<{ id: ChatId; sessionId: StoreId.Session }> {
  const uri = AIGatewayModelURI.Schema.parse(modelURI);
  const modelResult = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI: uri,
  });
  if (!modelResult.ok) {
    throw modelResult.error;
  }
  const model = modelResult.value;

  const chatSession = StoreId.newSessionId();
  const chatId: ChatId = await ensureChat(chatSession, prompt);
  await grantCaseFolders(chatId, folders);
  let sessionId = chatSession;
  if (kind === "task") {
    // The chat's model and apps are the task's, so the case's are the chat's,
    // as the composer's send would have made them.
    (
      await updateChatSettings(chatId, {
        ...(apps ? { apps } : {}),
        modelURI: uri,
      })
    )._unsafeUnwrap();
    const now = new Date();
    sessionId = (
      await addChildTask(chatId, {
        createdAt: now,
        id: StoreId.newSessionId(),
        title: name,
        updatedAt: now,
      })
    ).id;
  }

  const sent = await newMessage({
    files,
    folders,
    modelURI: uri,
    prompt,
    sessionId,
    chatId,
    ...(viewing ? { viewing } : {}),
  });
  if (sent.isErr()) {
    throw sent.error;
  }
  const message = sent.value;

  const session = (
    await ChatReads.session({ chatId: chatId, sessionId: sessionId })
  )._unsafeUnwrap();
  (
    await ChatWrites.saveSession(
      { ...session, title: name, updatedAt: new Date() },
      chatId,
    )
  )._unsafeUnwrap();
  // Named the way a person names a chat, which settles its title: otherwise a
  // chat case's first exchange retitles it, and a task case's chat stays a
  // placeholder, and `report <dir>` finds a run's case by that name.
  await renameChat(chatId, name);

  workspaceRef.send({
    type: "createSession",
    value: {
      id: chatId,
      message,
      model,
      sessionId,
    },
  });
  return { id: chatId, sessionId };
}

/**
 * Grants the chat each folder a case sends, before its first message. Sending
 * a folder grants nothing in the product (the agent asks when it first
 * reaches in), so a case's `folders` stand for folders this chat was already
 * allowed, as an earlier Allow in it would leave them.
 */
export async function grantCaseFolders(
  chatId: ChatId,
  folders: { path: string }[] = [],
) {
  for (const folder of folders) {
    await grantFolder({ chatId, path: folder.path, source: "card" });
  }
}
