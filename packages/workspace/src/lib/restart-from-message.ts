import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway";
import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import { sleep } from "radashi";

import { type WorkspaceActorRef } from "../machines/workspace";
import { publisher } from "../rpc/publisher";
import { type FileUpload } from "../schemas/file-upload";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type RelativePath } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getTaskAgentStatus } from "./get-task-agent-status";
import { newMessage } from "./new-message";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";

const STOP_WAIT_MS = 2500;
const STOP_POLL_MS = 50;

/**
 * Replace a user message and everything after it, then start a fresh agent
 * turn from the new message. Files on disk are left alone -- same tradeoff as
 * branching.
 */
export function restartFromMessage(
  {
    files,
    folders,
    keepFilePaths,
    messageId,
    model,
    modelURI,
    prompt,
    sessionId,
    taskId,
    workspaceRef,
  }: {
    files?: FileUpload.Type[];
    folders?: { access: FolderAttachment.Access; path: string }[];
    keepFilePaths?: RelativePath[];
    messageId: StoreId.Message;
    model: AIGatewayModel.Type;
    modelURI: AIGatewayModelURI.Type;
    prompt: string;
    sessionId: StoreId.Session;
    taskId: TaskId;
    workspaceRef: WorkspaceActorRef;
  },
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const existing = yield* Store.getMessageWithParts(
      { messageId, sessionId, taskId },
      { signal },
    );

    if (existing.role !== "user") {
      return errAsync(
        new TypedError.Conflict(
          `Only user messages can be restarted from: ${messageId}`,
        ),
      );
    }

    yield* await stopSessionIfAlive({ sessionId, taskId, workspaceRef });

    const keptFiles = resolveKeptFiles({
      keepFilePaths,
      message: existing,
      taskId,
    });

    const messageIdsAfter = yield* Store.getMessageIdsAfter(
      sessionId,
      messageId,
      taskId,
      { signal },
    );

    // Drop the edited message itself too: the replacement is a new send, and
    // keeping the old id would leave stale per-turn parts (browser status,
    // pane tabs) attached to text that no longer matches.
    for (const id of [messageId, ...messageIdsAfter]) {
      yield* Store.removeMessage(id, sessionId, taskId, { signal });
    }

    const messageResult = yield* await newMessage({
      files: [...keptFiles, ...(files ?? [])],
      folders,
      model,
      modelURI,
      prompt,
      sessionId,
      taskId,
    });

    workspaceRef.send({
      type: "addMessage",
      value: {
        agentName: "main",
        id: taskId,
        message: messageResult,
        model,
        sessionId: messageResult.metadata.sessionId,
      },
    });

    return ok({ sessionId: messageResult.metadata.sessionId });
  });
}

function isSessionAlive({
  sessionId,
  taskId,
  workspaceRef,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  workspaceRef: WorkspaceActorRef;
}) {
  const status = getTaskAgentStatus({ id: taskId, workspaceRef });
  if (status.isErr()) {
    return false;
  }
  const session = status.value.sessionActors.find(
    (actor) => actor.sessionId === sessionId,
  );
  return session?.tags.includes("agent.alive") ?? false;
}

function resolveKeptFiles({
  keepFilePaths,
  message,
  taskId,
}: {
  keepFilePaths: RelativePath[] | undefined;
  message: SessionMessage.WithParts;
  taskId: TaskId;
}): Extract<FileUpload.Type, { path: string }>[] {
  if (!keepFilePaths || keepFilePaths.length === 0) {
    return [];
  }

  const keep = new Set<string>(keepFilePaths);
  const attachmentsPart = message.parts.find(
    (part) => part.type === "data-attachments",
  );
  if (attachmentsPart?.type !== "data-attachments") {
    return [];
  }

  const dir = taskDir(taskId);
  const kept: Extract<FileUpload.Type, { path: string }>[] = [];
  for (const file of attachmentsPart.data.files) {
    if (!keep.has(file.filePath)) {
      continue;
    }
    kept.push({
      filename: file.filename,
      mimeType: file.mimeType,
      path: absolutePathJoin(dir, file.filePath),
      size: file.size,
    });
  }
  return kept;
}

function stopSessionIfAlive({
  sessionId,
  taskId,
  workspaceRef,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  workspaceRef: WorkspaceActorRef;
}) {
  return ResultAsync.fromPromise(
    (async () => {
      if (!isSessionAlive({ sessionId, taskId, workspaceRef })) {
        return;
      }

      workspaceRef.send({
        type: "stopSessions",
        value: { id: taskId },
      });

      const done = waitForSessionDone({ sessionId, taskId });
      const deadline = Date.now() + STOP_WAIT_MS;
      while (Date.now() < deadline) {
        if (!isSessionAlive({ sessionId, taskId, workspaceRef })) {
          done.abort();
          return;
        }
        await Promise.race([sleep(STOP_POLL_MS), done.promise]);
      }

      done.abort();
      if (isSessionAlive({ sessionId, taskId, workspaceRef })) {
        throw new TypedError.Conflict(
          "Timed out waiting for the agent to stop before restarting",
        );
      }
    })(),
    (error) =>
      error instanceof TypedError.Conflict
        ? error
        : new TypedError.Unknown(
            error instanceof Error ? error.message : "Unknown error",
            { cause: error },
          ),
  );
}

function waitForSessionDone({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  const abort = new AbortController();
  const promise = (async () => {
    try {
      for await (const payload of publisher.subscribe("session.done", {
        signal: abort.signal,
      })) {
        if (payload.id === taskId && payload.sessionId === sessionId) {
          return;
        }
      }
    } catch {
      // Aborted or closed; the poll loop decides what to do next.
    }
  })();

  return {
    abort: () => {
      abort.abort();
    },
    promise,
  };
}
