import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { call, eventIterator } from "@orpc/server";
import { ok, type Result } from "neverthrow";
import { z } from "zod";

import { agentNameForTask } from "../../../lib/agent-name-for-task";
import { changedMessageBatches } from "../../../lib/changed-message-batches";
import { createSession } from "../../../lib/create-session";
import { defaultTaskName } from "../../../lib/default-task-name";
import { type TypedError } from "../../../lib/errors";
import { generateTitleFromUserMessage } from "../../../lib/generate-title-from-user-message";
import { getTask } from "../../../lib/get-tasks";
import { initializeTask } from "../../../lib/initialize-task";
import { newMessage } from "../../../lib/new-message";
import { newTaskId } from "../../../lib/new-task-id";
import { ensureChat } from "../../../lib/chat/chat-records";
import { Store } from "../../../lib/store";

import { updateTaskSettings } from "../../../lib/task-settings";
import { updateSessionTitle } from "../../../lib/update-session-title";
import {
  getTaskUsageSummary,
  UsageSummarySchema,
} from "../../../lib/usage-summary";
import { FileUpload } from "../../../schemas/file-upload";
import { FolderAttachment } from "../../../schemas/folder-attachment";

import { SessionMessageDataPart } from "../../../schemas/session/message-data-part";
import { StoreId } from "../../../schemas/store-id";
import { TaskSchema } from "../../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";
import { liveRead, where } from "../../live-read";
import { liveTaskActivity } from "./activity";
import { taskAgentStatus } from "./agent-status";
import { taskBackgroundProcesses } from "./background-processes";
import { taskFiles } from "./files";
import { taskState } from "./state";

const byId = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskSchema)
  .handler(async ({ errors, input }) => {
    const result = await getTask(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const create = base
  .input(
    z.object({
      files: z.array(FileUpload.Schema).optional(),
      folders: z
        .array(
          z.object({
            access: FolderAttachment.AccessSchema,
            path: z.string(),
          }),
        )
        .optional(),
      intent: SessionMessageDataPart.IntentDataPartSchema.shape.text.optional(),
      // A chat is created this way only by the eval harness, and it
      // is made a chat, the way the window's first send makes one.
      chat: z.boolean().optional(),
      modelURI: AIGatewayModelURI.Schema,
      name: z.string().trim().min(1).optional(),

      prompt: z.string(),
      /** What the window had on screen, as the note on the first message: the eval harness's stand-in for a window. */
      viewing: SessionMessageDataPart.ViewContextDataPartSchema.optional(),
    }),
  )
  .output(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .handler(
    async ({
      context,
      errors,
      input: { chat, files, folders, intent, modelURI, name, prompt, viewing },
      signal,
    }) => {
      const modelResult = await fetchModel({
        captureException: context.workspaceConfig.captureException,
        configs: context.workspaceConfig.getAIProviderConfigs(),
        modelCache: context.workspaceConfig.modelCache,
        modelURI,
      });

      if (!modelResult.ok) {
        const error = modelResult.error;
        context.workspaceConfig.captureException(error);
        throw toORPCError(error, errors);
      }

      const model = modelResult.value;

      // Made the way the window's first send makes a chat: a record of its
      // own, named for the words it opens with.
      const chatSession = chat ? StoreId.newSessionId() : undefined;
      const initialTaskName = name ?? defaultTaskName(prompt);
      let taskId: TaskId;
      let result: Result<unknown, TypedError.Type> = ok(undefined);
      if (chatSession) {
        taskId = await ensureChat(chatSession, prompt);
      } else {
        taskId = await newTaskId({
          prompt,
          workspaceConfig: context.workspaceConfig,
        });
        result = await initializeTask(
          {
            initialSettings: { name: initialTaskName },
            taskId,
            workspaceConfig: context.workspaceConfig,
          },
          { signal },
        );
      }

      if (result.isErr()) {
        context.workspaceConfig.captureException(result.error);
        throw toORPCError(result.error, errors);
      }

      const sessionResult = await createSession({
        sessionId: chatSession ?? StoreId.newSessionId(),
        signal,
        taskId,
      });

      if (sessionResult.isErr()) {
        context.workspaceConfig.captureException(sessionResult.error);
        throw toORPCError(sessionResult.error, errors);
      }

      const userFolders = (folders ?? []).map((folder) => ({
        access: folder.access,
        path: folder.path,
        source: "user" as const,
      }));

      const messageResult = await newMessage({
        files,
        folders: userFolders.length > 0 ? userFolders : undefined,
        intent,
        model,
        modelURI,
        prompt,
        sessionId: sessionResult.value.id,
        taskId,
        ...(viewing ? { viewing } : {}),
      });

      if (messageResult.isErr()) {
        context.workspaceConfig.captureException(messageResult.error);
        throw toORPCError(messageResult.error, errors);
      }
      const message = messageResult.value;

      const sessionForTitle = await Store.getSession(
        message.metadata.sessionId,
        taskId,
      );
      if (sessionForTitle.isErr()) {
        context.workspaceConfig.captureException(sessionForTitle.error);
        throw toORPCError(sessionForTitle.error, errors);
      }
      const saveSessionTitleResult = await Store.saveSession(
        {
          ...sessionForTitle.value,
          title: initialTaskName,
          updatedAt: new Date(),
        },
        taskId,
      );
      if (saveSessionTitleResult.isErr()) {
        context.workspaceConfig.captureException(saveSessionTitleResult.error);
        throw toORPCError(saveSessionTitleResult.error, errors);
      }

      if (!name) {
        // Intentionally non blocking
        generateTitleFromUserMessage({
          message,
          model,
          workspaceConfig: context.workspaceConfig,
        }).then(async (title) => {
          if (title.isOk()) {
            // Skip both writes if the user renamed the task while generation was
            // in flight: replace only the placeholder we set at creation, and
            // push the generated name into settings only when that succeeded.
            const replaced = await updateSessionTitle({
              expectedCurrentTitle: initialTaskName,
              sessionId: message.metadata.sessionId,
              taskId,
              title: title.value,
            });
            if (replaced) {
              const secondSettingsResult = await updateTaskSettings(taskId, {
                name: title.value,
              });
              if (secondSettingsResult.isErr()) {
                context.workspaceConfig.captureException(
                  secondSettingsResult.error,
                );
              }
            }
          }
        });
      }

      publisher.publish("task.updated", {
        id: taskId,
      });

      context.workspaceRef.send({
        type: "createSession",
        value: {
          agentName: agentNameForTask(taskId),
          id: taskId,
          message,
          model,
          sessionId: message.metadata.sessionId,
        },
      });

      context.workspaceConfig.captureEvent("task.created", {
        files_count: files?.length ?? 0,
        modelId: model.canonicalId,
        providerId: model.params.provider,
      });

      return {
        id: taskId,
        sessionId: message.metadata.sessionId,
      };
    },
  );

const live = {
  byId: base
    .input(z.object({ id: TaskIdSchema }))
    .output(eventIterator(TaskSchema))
    .handler(async function* ({ context, input, signal }) {
      yield* liveRead({
        changes: [
          where(
            publisher.subscribe("task.updated", { signal }),
            (payload) => payload.id === input.id,
          ),
        ],
        read: () => call(byId, input, { context, signal }),
      });
    }),
};

const usageSummary = base
  .input(z.object({ id: TaskIdSchema }))
  .output(UsageSummarySchema)
  .handler(async ({ input, signal }) => {
    const { id } = input;
    const taskId = id;
    return getTaskUsageSummary(taskId, { signal });
  });

const liveUsageSummary = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(UsageSummarySchema))
  .handler(async function* ({ context, input, signal }) {
    // Coalesce this task's message/part events so a streaming turn recomputes
    // the (whole-task) summary once per batch instead of once per event.
    const batches = changedMessageBatches({ id: input.id }, signal);
    try {
      yield call(usageSummary, input, { context, signal });
      for await (const _batch of batches) {
        yield call(usageSummary, input, { context, signal });
      }
    } finally {
      await batches.return();
    }
  });

export const task = {
  agentStatus: taskAgentStatus,
  backgroundProcesses: taskBackgroundProcesses,
  byId,
  create,
  files: taskFiles,
  live: {
    ...live,
    activity: liveTaskActivity,
    usageSummary: liveUsageSummary,
  },
  state: taskState,
  usageSummary,
};
