import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call, eventIterator } from "@orpc/server";
import { parallel } from "radashi";
import { z } from "zod";

import { branchTask } from "../../../lib/branch-task";
import { changedMessageBatches } from "../../../lib/changed-message-batches";
import { createSession } from "../../../lib/create-session";
import { defaultTaskName } from "../../../lib/default-task-name";
import { exportTaskZip } from "../../../lib/export-task-zip";
import { findAvailableName } from "../../../lib/find-available-name";
import { generateTitleFromUserMessage } from "../../../lib/generate-title-from-user-message";
import { getTask, getTasks } from "../../../lib/get-tasks";
import { importTask as importTaskLib } from "../../../lib/import-task";
import { initializeTask } from "../../../lib/initialize-task";
import { newMessage } from "../../../lib/new-message";
import { newTaskId } from "../../../lib/new-task-id";
import { pathExists } from "../../../lib/path-exists";
import { getProject } from "../../../lib/project";
import { normalizeProjectInstructions } from "../../../lib/project-instructions";
import { Store } from "../../../lib/store";
import { taskDir } from "../../../lib/task-dir-utils";
import {
  clearTaskIndicator,
  setTaskIndicator,
} from "../../../lib/task-indicators";
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
import { FolderAttachment } from "../../../schemas/folder-attachment";
import { AbsolutePathSchema } from "../../../schemas/paths";
import { type Project } from "../../../schemas/project";
import { ProjectIdSchema } from "../../../schemas/project-id";
import { SessionMessageDataPart } from "../../../schemas/session/message-data-part";
import { StoreId } from "../../../schemas/store-id";
import { TaskSchema } from "../../../schemas/task";
import { TaskIdSchema } from "../../../schemas/task-id";
import { TaskSettingsUpdateSchema } from "../../../schemas/task-settings";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";
import { liveTaskActivity, taskActivity } from "./activity";
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
    const taskResults = await parallel(
      { limit: 12 },
      input.ids,
      async (id) => ({
        id,
        result: await getTask(id, context.workspaceConfig),
      }),
    );

    const results = [];
    for (const { id, result } of taskResults) {
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
      folders: z
        .array(
          z.object({
            access: FolderAttachment.AccessSchema,
            path: z.string(),
          }),
        )
        .optional(),
      intent: SessionMessageDataPart.IntentDataPartSchema.shape.text.optional(),
      modelURI: AIGatewayModelURI.Schema,
      name: z.string().trim().min(1).optional(),
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
      input: { files, folders, intent, modelURI, name, projectId, prompt },
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

      // Validate project early to avoid orphan projectId; also needed for folder attachment below.
      let project: Project | undefined;
      if (projectId) {
        const projectResult = await getProject(projectId);
        if (projectResult.isErr()) {
          throw toORPCError(projectResult.error, errors);
        }
        project = projectResult.value;
      }

      const taskId = await newTaskId({
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

      // Merge the project's folders onto the first message (deduped against any
      // the user attached). Each folder carries its source so later consumers
      // tell project from user folders without re-deriving from paths.
      const userFolders = (folders ?? []).map((folder) => ({
        access: folder.access,
        path: folder.path,
        source: "user" as const,
      }));
      let mergedFolders: {
        access: FolderAttachment.Access;
        path: string;
        source: FolderAttachment.Source;
      }[] = userFolders;
      if (project && project.folders.length > 0) {
        const seen = new Set(userFolders.map((folder) => folder.path));
        mergedFolders = [
          ...userFolders,
          ...project.folders
            .filter((folder) => !seen.has(folder.path))
            .map((folder) => ({
              access: folder.access,
              path: folder.path,
              source: "project" as const,
            })),
        ];
      }

      // Frozen snapshot of the project's identity and instructions for this task.
      // Captured at creation so later project edits/deletion don't affect it; the
      // agent and UI read this instead of the live project.
      const projectContext = project
        ? {
            // project already carries instructions from getProject above, so
            // normalize those rather than re-reading them from projects/.
            instructions: normalizeProjectInstructions(project.instructions),
            projectId: project.id,
            projectName: project.name,
          }
        : undefined;

      const messageResult = await newMessage({
        files,
        folders: mergedFolders.length > 0 ? mergedFolders : undefined,
        intent,
        model,
        modelURI,
        projectContext,
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
          projectName: project?.name,
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

const branch = base
  .input(
    z.object({
      // When set, the branch keeps the conversation only up to and including
      // this message. Omit to branch the whole task.
      branchPoint: z
        .object({
          messageId: StoreId.MessageSchema,
          sessionId: StoreId.SessionSchema,
        })
        .optional(),
      sourceTaskId: TaskIdSchema,
    }),
  )
  .output(TaskSchema)
  .handler(
    async ({
      context,
      errors,
      input: { branchPoint, sourceTaskId },
      signal,
    }) => {
      const result = await branchTask(
        {
          branchPoint,
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

    // The unread indicator lives in the task's settings.json, so it is gone
    // with the folder -- no separate cleanup needed.

    context.workspaceConfig.captureEvent("task.trashed");
  });

// Unread indicators: marked when an agent finishes (see the workspace machine's
// session.done handler) and cleared once the user has viewed the task. Both
// writes go through task settings, which publishes task.updated.
const clearIndicator = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ errors, input }) => {
    const result = await clearTaskIndicator(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
  });

// Explicit "mark as unread". Flagged manual so viewing the task it was set from
// does not clear it -- it holds until the user leaves and returns, or clears now
// via clearIndicator ("mark as read").
const markUnread = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ errors, input }) => {
    const result = await setTaskIndicator(input.id, "completed", {
      manual: true,
    });
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
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

      const { name: filename } = await findAvailableName({
        isTaken: (candidate) =>
          pathExists(
            AbsolutePathSchema.parse(`${input.outputPath}/${candidate}`),
          ),
        name: `${safeName}.zip`,
        splitExtension: true,
      });
      const filepath = `${input.outputPath}/${filename}`;

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
  activity: taskActivity,
  agentStatus: taskAgentStatus,
  branch,
  byId,
  byIds,
  clearIndicator,
  create,
  createTutorial,
  exportZip,
  files: taskFiles,
  import: importTask,
  list,
  live: {
    ...live,
    activity: liveTaskActivity,
    usageSummary: liveUsageSummary,
  },
  markUnread,
  state: taskState,
  trash,
  update,
  usageSummary,
};
