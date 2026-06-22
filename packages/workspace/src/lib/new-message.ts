import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway";
import { ok } from "neverthrow";

import { type FileUpload } from "../schemas/file-upload";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./app-dir-utils";
import { createBrowserStatusPart } from "./create-browser-status-part";
import { detectExternalFileChanges } from "./external-file-changes";
import { setProjectState } from "./project-state-store";
import { getWorkspaceConfig } from "./workspace-config";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

export async function newMessage({
  files,
  folders,
  model,
  modelURI,
  prompt,
  sessionId,
  taskId,
}: {
  files?: FileUpload.Type[];
  folders?: { path: string }[];
  model: AIGatewayModel.Type;
  modelURI: AIGatewayModelURI.Type;
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

  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts,
    role: "user",
  };

  await setProjectState(taskDir(taskId), { selectedModelURI: modelURI });

  getWorkspaceConfig().captureEvent("message.created", {
    files_count: files?.length ?? 0,
    modelId: model.canonicalId,
    providerId: model.params.provider,
  });

  return ok(message);
}
