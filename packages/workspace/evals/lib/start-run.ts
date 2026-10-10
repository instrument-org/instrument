import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";

import { type WorkspaceActorRef } from "../../src/machines/workspace";
import { ensureChat } from "../../src/lib/chat/chat-records";
import { addChildTask } from "../../src/lib/chat/children";
import { createSession } from "../../src/lib/create-session";
import { newMessage } from "../../src/lib/new-message";
import { Store } from "../../src/lib/store";
import { updateChatSettings } from "../../src/lib/chat-settings";
import { type FileUpload } from "../../src/schemas/file-upload";
import { type FolderAttachment } from "../../src/schemas/folder-attachment";
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
    folders?: { access?: FolderAttachment.Access; path: string }[];
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
  const chatId = await ensureChat(chatSession, prompt);
  const taskId: ChatId = chatId;
  let sessionId = chatSession;
  (await createSession({ sessionId: chatSession, taskId }))._unsafeUnwrap();
  if (kind === "task") {
    // The chat's apps are the task's, so the case's are handed to the chat.
    if (apps) {
      (await updateChatSettings(chatId, { apps }))._unsafeUnwrap();
    }
    const now = new Date();
    sessionId = (
      await addChildTask(chatId, {
        createdAt: now,
        id: StoreId.newSessionId(),
        status: "running",
        title: name,
        updatedAt: now,
      })
    ).id;
  }

  const sent = await newMessage({
    files,
    folders: folders?.map((folder) => ({ ...folder, source: "user" })),
    model,
    modelURI: uri,
    prompt,
    sessionId,
    taskId,
    ...(viewing ? { viewing } : {}),
  });
  if (sent.isErr()) {
    throw sent.error;
  }
  const message = sent.value;

  const session = (await Store.getSession(sessionId, taskId))._unsafeUnwrap();
  (
    await Store.saveSession(
      { ...session, title: name, updatedAt: new Date() },
      taskId,
    )
  )._unsafeUnwrap();

  workspaceRef.send({
    type: "createSession",
    value: {
      id: taskId,
      message,
      model,
      sessionId,
    },
  });
  return { id: taskId, sessionId };
}
