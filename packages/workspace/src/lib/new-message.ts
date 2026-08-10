import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway";
import { extractSkillMentions } from "@instrument-org/shared/skill-mention";
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
import { createPaneTabsPart } from "./create-pane-tabs-part";
import { detectProjectChanges } from "./detect-project-changes";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-state-store";
import { getWorkspaceConfig } from "./workspace-config";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

export async function newMessage({
  files,
  folders,
  intent,
  model,
  modelURI,
  projectContext,
  prompt,
  sessionId,
  taskId,
}: {
  files?: FileUpload.Type[];
  folders?: {
    access?: FolderAttachment.Access;
    path: string;
    source?: FolderAttachment.Source;
  }[];
  intent?: string;
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

  const paneTabsPart = await createPaneTabsPart({
    createdAt,
    messageId,
    sessionId,
    taskId,
  });
  if (paneTabsPart) {
    parts.push(paneTabsPart);
  }

  // Notify agent when the live project's instructions or folders drift from the
  // task's frozen snapshot. Also writes folder additions/removals into task
  // state so they become standing context.
  const projectChanges = await detectProjectChanges({
    messageId,
    sessionId,
    taskId,
  });
  if (projectChanges.isErr()) {
    // Awareness of project drift is best-effort; never block sending.
    getWorkspaceConfig().captureException(projectChanges.error);
  } else if (projectChanges.value) {
    parts.push(projectChanges.value);
  }

  // Notify agent of folders removed or renamed since last turn (per-session
  // baseline diff). Runs after writeUploadedAttachments/detectProjectChanges
  // above so a rename either of them triggers this message is read as part of
  // "current" and reported now instead of lagging a turn behind.
  const folderChanges = await detectAttachedFolderChanges({
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

  getWorkspaceConfig().captureEvent("message.created", {
    files_count: files?.length ?? 0,
    modelId: model.canonicalId,
    providerId: model.params.provider,
  });

  return ok(message);
}
