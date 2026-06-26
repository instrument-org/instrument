import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway";
import { ok } from "neverthrow";

import { type FileUpload } from "../schemas/file-upload";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { detectAttachedFolderChanges } from "./attached-folder-changes";
import { createBrowserStatusPart } from "./create-browser-status-part";
import { detectExternalFileChanges } from "./external-file-changes";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-state-store";
import { getWorkspaceConfig } from "./workspace-config";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

export async function newMessage({
  files,
  folders,
  model,
  modelURI,
  projectContext,
  prompt,
  sessionId,
  taskId,
}: {
  files?: FileUpload.Type[];
  folders?: { path: string; source?: FolderAttachment.Source }[];
  model: AIGatewayModel.Type;
  modelURI: AIGatewayModelURI.Type;
  projectContext?: SessionMessageDataPart.ProjectContextDataPart;
  prompt: string;
  sessionId: StoreId.Session;
  taskId: TaskId;
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

    parts.push(uploadResult.value.part);
  }

  if (projectContext) {
    parts.push({
      data: projectContext,
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-projectContext",
    });
  }

  const browserStatusPart = await createBrowserStatusPart({
    createdAt,
    messageId,
    sessionId,
    taskId,
  });
  if (browserStatusPart) {
    parts.push(browserStatusPart);
  }

  const externalChanges = await detectExternalFileChanges({
    messageId,
    sessionId,
    taskId,
  });
  if (externalChanges.isErr()) {
    // Awareness of disk changes is best-effort; never block sending.
    getWorkspaceConfig().captureException(externalChanges.error);
  } else if (externalChanges.value) {
    parts.push(externalChanges.value);
  }

  // Notify agent of folders removed since last turn (per-session baseline diff).
  const folderChanges = await detectAttachedFolderChanges({
    messageId,
    sessionId,
    taskId,
  });
  if (folderChanges.isErr()) {
    // Awareness of folder removals is best-effort; never block sending.
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

  getWorkspaceConfig().captureEvent("message.created", {
    files_count: files?.length ?? 0,
    modelId: model.canonicalId,
    providerId: model.params.provider,
  });

  return ok(message);
}
