import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { createSession } from "../../../lib/create-session";
import { defaultTaskName } from "../../../lib/default-task-name";
import { duplicateTask } from "../../../lib/duplicate-task";
import { exportTaskZip } from "../../../lib/export-task-zip";
import { generateTitleFromUserMessage } from "../../../lib/generate-title-from-user-message";
import { getTask, getTasks } from "../../../lib/get-tasks";
import { importTask as importTaskLib } from "../../../lib/import-task";
import { initializeTask } from "../../../lib/initialize-task";
import { newMessage } from "../../../lib/new-message";
import { newTaskId } from "../../../lib/new-task-id";
import { pathExists } from "../../../lib/path-exists";
import { Store } from "../../../lib/store";
import { taskDir } from "../../../lib/task-dir-utils";
import {
  getTaskSettings,
  updateTaskSettings,
} from "../../../lib/task-settings";
import { trashTask } from "../../../lib/trash-task";
import { startTutorialTaskReplay } from "../../../lib/tutorial-task-replay";
import { updateSessionTitle } from "../../../lib/update-session-title";
import {
  getTaskUsageSummary,
  UsageSummarySchema,
} from "../../../lib/usage-summary";
import { FileUpload } from "../../../schemas/file-upload";
import { AbsolutePathSchema } from "../../../schemas/paths";
import { ProjectIdSchema } from "../../../schemas/project-id";
import { StoreId } from "../../../schemas/store-id";
import { SubdomainPartSchema } from "../../../schemas/subdomain-part";
import { TaskSchema } from "../../../schemas/task";
import { TaskIdSchema } from "../../../schemas/task-id";
import { TaskSettingsUpdateSchema } from "../../../schemas/task-settings";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";
import { taskAgentStatus } from "./agent-status";
import { taskFiles } from "./files";
import { taskState } from "./state";

const byId = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskSchema)
  .handler(async ({ context, errors, input }) => {
    const result = await getTask(input.id, context.workspaceConfig);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const byIds = base
  .input(z.object({ ids: TaskIdSchema.array() }))
  .output(
    z
      .discriminatedUnion("ok", [
        z.object({
          data: TaskSchema,
          ok: z.literal(true),
        }),
        z.object({
          error: z.object({ type: z.literal("not-found") }),
          id: TaskIdSchema,
          ok: z.literal(false),
        }),
      ])
      .array(),
  )
  .handler(async ({ context, errors, input }) => {
    const results = [];
    for (const id of input.ids) {
      const result = await getTask(id, context.workspaceConfig);
      if (result.isErr()) {
        if (result.error.type === "workspace-not-found-error") {
          results.push({
            error: { type: "not-found" as const },
            id,
            ok: false as const,
          });
          continue;
        }
        throw toORPCError(result.error, errors);
      }
      results.push({
        data: result.value,
        ok: true as const,
      });
    }
    return results;
  });

const TasksWithTotalSchema = z.object({
  tasks: TaskSchema.array(),
  total: z.number(),
});

const ListInputSchema = z
  .object({
    direction: z.enum(["asc", "desc"]).optional(),
    limit: z.number().optional(),
    sortBy: z.enum(["createdAt", "updatedAt"]).optional(),
  })
  .default({
    direction: "desc",
    sortBy: "updatedAt",
  });

const list = base
  .input(ListInputSchema)
  .output(TasksWithTotalSchema)
  .handler(async ({ context, input }) => {
    return getTasks(context.workspaceConfig, input);
  });

const create = base
  .input(
    z.object({
      files: z.array(FileUpload.Schema).optional(),
      folders: z.array(z.object({ path: z.string() })).optional(),
      modelURI: AIGatewayModelURI.Schema,
      name: z.string().trim().min(1).optional(),
      preferredFolderName: SubdomainPartSchema.optional(),
      projectId: ProjectIdSchema.nullish(),
      prompt: z.string(),
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
      input: {
        files,
        folders,
        modelURI,
        name,
        preferredFolderName,
        projectId,
        prompt,
      },
      signal,
    }) => {
      const modelResult = await fetchModel({
        captureException: context.workspaceConfig.captureException,
        configs: context.workspaceConfig.getAIProviderConfigs(),
        modelURI,
      });

      if (!modelResult.ok) {
        const error = modelResult.error;
        context.workspaceConfig.captureException(error);
        throw toORPCError(error, errors);
      }

      const model = modelResult.value;

      const taskId = await newTaskId({
        preferredFolderName,
        prompt,
        workspaceConfig: context.workspaceConfig,
      });

      const initialTaskName = name ?? defaultTaskName(prompt);

      const result = await initializeTask(
        {
          initialSettings: {
            name: initialTaskName,
            projectId: projectId ?? undefined,
          },
          taskId,
          workspaceConfig: context.workspaceConfig,
        },
        { signal },
      );

      if (result.isErr()) {
        context.workspaceConfig.captureException(result.error);
        throw toORPCError(result.error, errors);
      }

      const sessionResult = await createSession({
        sessionId: StoreId.newSessionId(),
        signal,
        taskId,
      });

      if (sessionResult.isErr()) {
        context.workspaceConfig.captureException(sessionResult.error);
        throw toORPCError(sessionResult.error, errors);
      }

      const messageResult = await newMessage({
        files,
        folders,
        model,
        modelURI,
        prompt,
        sessionId: sessionResult.value.id,
        taskId,
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
            // Must come before updateTaskSettings so updateSessionTitle can
            // detect if the title is auto replaceable
            await updateSessionTitle({
              sessionId: message.metadata.sessionId,
              taskId,
              title: title.value,
            });
            const secondSettingsResult = await updateTaskSettings(taskId, {
              name: title.value,
            });
            if (secondSettingsResult.isErr()) {
              context.workspaceConfig.captureException(
                secondSettingsResult.error,
              );
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
          agentName: "main",
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

const createTutorial = base
  .input(z.object({ delayMs: z.number().int().min(0).optional() }).optional())
  .output(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .handler(async ({ context, errors, input, signal }) => {
    const result = await startTutorialTaskReplay({
      delayMs: input?.delayMs,
      signal,
      workspaceConfig: context.workspaceConfig,
    });

    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }

    return {
      id: result.value.id,
      sessionId: result.value.sessionId,
    };
  });

const duplicate = base
  .input(
    z.object({
      keepHistory: z.boolean().optional().default(false),
      sourceTaskId: TaskIdSchema,
    }),
  )
  .output(TaskSchema)
  .handler(
    async ({
      context,
      errors,
      input: { keepHistory, sourceTaskId },
      signal,
    }) => {
      const result = await duplicateTask(
        {
          keepHistory,
          sourceTaskId,
          workspaceConfig: context.workspaceConfig,
        },
        { signal },
      );

      if (result.isErr()) {
        context.workspaceConfig.captureException(result.error);
        throw toORPCError(result.error, errors);
      }

      publisher.publish("task.updated", {
        id: result.value.taskId,
      });

      const taskResult = await getTask(
        result.value.taskId,
        context.workspaceConfig,
      );
      if (taskResult.isErr()) {
        context.workspaceConfig.captureException(taskResult.error);
        throw toORPCError(taskResult.error, errors);
      }

      context.workspaceConfig.captureEvent("task.forked");

      return taskResult.value;
    },
  );

const importTask = base
  .input(
    z.object({
      zipFileData: z.string(),
    }),
  )
  .output(
    z.object({
      id: TaskIdSchema,
    }),
  )
  .handler(async ({ context, errors, input: { zipFileData }, signal }) => {
    const result = await importTaskLib(
      {
        workspaceConfig: context.workspaceConfig,
        zipFileData,
      },
      { signal },
    );

    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }

    publisher.publish("task.updated", {
      id: result.value.taskId,
    });

    context.workspaceConfig.captureEvent("task.imported");

    return { id: result.value.taskId };
  });

const trash = base
  .input(z.object({ id: TaskIdSchema }))
  .handler(async ({ context, errors, input: { id } }) => {
    const result = await trashTask({
      id,
      workspaceConfig: context.workspaceConfig,
      workspaceRef: context.workspaceRef,
    });

    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
    publisher.publish("task.removed", {
      id,
    });

    context.workspaceConfig.captureEvent("task.trashed");
  });

const update = base
  .input(
    TaskSettingsUpdateSchema.extend({
      id: TaskIdSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, errors, input: { id, ...updates } }) => {
    const taskId = id;

    if (updates.name !== undefined) {
      const sessionsResult = await Store.getSessions(taskId);
      if (sessionsResult.isOk()) {
        const sessions = sessionsResult.value;
        const session = sessions[0];
        if (sessions.length === 1 && session !== undefined) {
          await Store.saveSession(
            { ...session, title: updates.name, updatedAt: new Date() },
            taskId,
          );
        }
      }
    }

    const result = await updateTaskSettings(taskId, updates);

    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }

    context.workspaceConfig.captureEvent("task.updated");
  });

const exportZip = base
  .errors({
    EXPORT_FAILED: {
      message: "Failed to export task",
    },
  })
  .input(
    z.object({
      id: TaskIdSchema,
      outputPath: z.string(),
    }),
  )
  .output(
    z.object({
      filename: z.string(),
      filepath: z.string(),
    }),
  )
  .handler(async ({ context, errors, input }) => {
    try {
      const taskId = input.id;

      const settings = await getTaskSettings(taskDir(taskId));
      const taskName = settings?.name ?? input.id;

      const safeName = taskName
        .toLowerCase()
        .replaceAll(/[^a-z0-9-]/g, "-")
        .replaceAll(/-+/g, "-")
        .replaceAll(/^-|-$/g, "")
        .slice(0, 50);

      let counter = 1;
      let filename = `${safeName}.zip`;
      let filepath = `${input.outputPath}/${filename}`;

      while (await pathExists(AbsolutePathSchema.parse(filepath))) {
        counter++;
        filename = `${safeName}-${counter}.zip`;
        filepath = `${input.outputPath}/${filename}`;
      }

      const result = await exportTaskZip({
        dir: taskDir(taskId),
        outputPath: filepath,
      });

      if (result.isErr()) {
        throw errors.EXPORT_FAILED({ message: result.error.message });
      }

      context.workspaceConfig.captureEvent("task.shared", {
        share_type: "exported_zip",
      });

      return { filename, filepath };
    } catch (error) {
      throw errors.EXPORT_FAILED({
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

const OutputArtifactsCreatedSchema = z.object({
  files: z
    .object({
      filePath: z.string(),
      modifiedAt: z.number(),
    })
    .array(),
  sessionId: StoreId.SessionSchema,
});

const live = {
  byId: base
    .input(z.object({ id: TaskIdSchema }))
    .output(eventIterator(TaskSchema))
    .handler(async function* ({ context, input, signal }) {
      yield call(byId, input, { context, signal });

      const taskUpdates = publisher.subscribe("task.updated", { signal });

      for await (const payload of taskUpdates) {
        if (payload.id === input.id) {
          yield call(byId, input, { context, signal });
        }
      }
    }),
  byIds: base
    .input(z.object({ ids: TaskIdSchema.array() }))
    .output(
      eventIterator(
        z
          .discriminatedUnion("ok", [
            z.object({
              data: TaskSchema,
              ok: z.literal(true),
            }),
            z.object({
              error: z.object({ type: z.literal("not-found") }),
              id: TaskIdSchema,
              ok: z.literal(false),
            }),
          ])
          .array(),
      ),
    )
    .handler(async function* ({ context, input, signal }) {
      yield call(byIds, input, { context, signal });

      const taskUpdates = publisher.subscribe("task.updated", { signal });
      const taskRemoved = publisher.subscribe("task.removed", { signal });

      for await (const payload of mergeGenerators([taskUpdates, taskRemoved])) {
        if (input.ids.includes(payload.id)) {
          yield call(byIds, input, { context, signal });
        }
      }
    }),
  list: base
    .input(ListInputSchema)
    .output(eventIterator(TasksWithTotalSchema))
    .handler(async function* ({ context, input, signal }) {
      yield call(list, input, { context, signal });

      const taskUpdates = publisher.subscribe("task.updated", { signal });
      const taskRemoved = publisher.subscribe("task.removed", { signal });

      for await (const _ of mergeGenerators([taskUpdates, taskRemoved])) {
        yield call(list, input, { context, signal });
      }
    }),
  // Forwards artifact-produced events as they happen. Unlike the other live
  // endpoints this is a pure event stream (no initial snapshot): clients only
  // react to runs that finish while subscribed.
  outputArtifacts: base
    .input(z.object({ id: TaskIdSchema }))
    .output(eventIterator(OutputArtifactsCreatedSchema))
    .handler(async function* ({ input, signal }) {
      const events = publisher.subscribe("task.outputArtifactsCreated", {
        signal,
      });

      for await (const payload of events) {
        if (payload.id === input.id) {
          yield {
            files: payload.files,
            sessionId: payload.sessionId,
          };
        }
      }
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
    yield call(usageSummary, input, { context, signal });

    const messageUpdates = publisher.subscribe("message.updated", { signal });
    const messageRemoved = publisher.subscribe("message.removed", { signal });
    const partUpdates = publisher.subscribe("part.updated", { signal });

    async function* filterByTaskId(
      generator:
        | typeof messageRemoved
        | typeof messageUpdates
        | typeof partUpdates,
    ) {
      for await (const payload of generator) {
        if (payload.id === input.id) {
          yield null;
        }
      }
    }

    for await (const _ of mergeGenerators([
      filterByTaskId(messageUpdates),
      filterByTaskId(messageRemoved),
      filterByTaskId(partUpdates),
    ])) {
      yield call(usageSummary, input, { context, signal });
    }
  });

export const task = {
  agentStatus: taskAgentStatus,
  byId,
  byIds,
  create,
  createTutorial,
  duplicate,
  exportZip,
  files: taskFiles,
  import: importTask,
  list,
  live: {
    ...live,
    usageSummary: liveUsageSummary,
  },
  state: taskState,
  trash,
  update,
  usageSummary,
};
