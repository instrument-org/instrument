import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";

import { type WorkspaceActorRef } from "../../src/machines/workspace";
import { agentNameForTask } from "../../src/lib/agent-name-for-task";
import { ensureChat } from "../../src/lib/chat/chat-records";
import { createSession } from "../../src/lib/create-session";
import { initializeTask } from "../../src/lib/initialize-task";
import { newMessage } from "../../src/lib/new-message";
import { newTaskId } from "../../src/lib/new-task-id";
import { Store } from "../../src/lib/store";
import { type FileUpload } from "../../src/schemas/file-upload";
import { type FolderAttachment } from "../../src/schemas/folder-attachment";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { StoreId } from "../../src/schemas/store-id";
import { type TaskId } from "../../src/schemas/task-id";
import { type WorkspaceConfig } from "../../src/types";

/**
 * Starts one eval run the way the product starts the agent it measures.
 *
 * A chat case opens a chat with the prompt, as the window's first send does.
 * A task case makes a chat and a task inside it, then sends the prompt to the
 * task, as `task new` does after the chat decides to delegate: the task agent
 * answers in a task a chat owns, the only kind the product makes, without
 * spending a chat turn to get there. That chat is never written in, so it is
 * never woken when the task finishes.
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
    /** The apps a task case is handed, as a chat's `task new --app` hands them. */
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
): Promise<{ id: TaskId; sessionId: StoreId.Session }> {
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
  let taskId: TaskId = chatId;
  let sessionId = chatSession;
  if (kind === "task") {
    (
      await createSession({ sessionId: chatSession, taskId: chatId })
    )._unsafeUnwrap();
    taskId = await newTaskId({ prompt, workspaceConfig });
    (
      await initializeTask(
        {
          chatId,
          initialSettings: { apps, name },
          taskId,
          workspaceConfig,
        },
        {},
      )
    )._unsafeUnwrap();
    sessionId = StoreId.newSessionId();
  }
  (await createSession({ sessionId, taskId }))._unsafeUnwrap();

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
      agentName: agentNameForTask(taskId),
      id: taskId,
      message,
      model,
      sessionId,
    },
  });
  return { id: taskId, sessionId };
}
