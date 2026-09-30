import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { call, eventIterator } from "@orpc/server";
import { ok, type Result } from "neverthrow";
import { z } from "zod";

import { agentNameForTask } from "../../../lib/agent-name-for-task";
import { changedMessageBatches } from "../../../lib/changed-message-batches";
import { createSession } from "../../../lib/create-session";
import { defaultTaskName } from "../../../lib/default-task-name";
import { type TypedError } from "../../../lib/errors";
import { exportTaskZip } from "../../../lib/export-task-zip";
import { findAvailableName } from "../../../lib/find-available-name";
import { generateTitleFromUserMessage } from "../../../lib/generate-title-from-user-message";
import { getTask, getTasks } from "../../../lib/get-tasks";
import { importTask as importTaskLib } from "../../../lib/import-task";
import { initializeTask } from "../../../lib/initialize-task";
import { newMessage } from "../../../lib/new-message";
import { newTaskId } from "../../../lib/new-task-id";
import { ensureChat } from "../../../lib/orchestrator/chat-records";
import { pathExists } from "../../../lib/path-exists";
import { getProject } from "../../../lib/project";
import { normalizeProjectInstructions } from "../../../lib/project-instructions";
import { Store } from "../../../lib/store";
import { taskDir } from "../../../lib/task-dir-utils";
import { setTaskState } from "../../../lib/task-record";
import {
  getTaskSettings,
  updateTaskSettings,
} from "../../../lib/task-settings";
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
import { type TaskId, TaskIdSchema } from "../../../schemas/task-id";
import { TaskKindSchema } from "../../../schemas/task-kind";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";
import { liveTaskActivity, taskActivity } from "./activity";
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
      // An orchestrator is created this way only by the eval harness, and it
      // is made a chat, the way the window's first send makes one.
      kind: TaskKindSchema.optional(),
      modelURI: AIGatewayModelURI.Schema,
      name: z.string().trim().min(1).optional(),
      projectId: ProjectIdSchema.nullish(),
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
      input: {
        files,
        folders,
        intent,
        kind,
        modelURI,
        name,
        projectId,
        prompt,
        viewing,
      },
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

      // An orchestrator made here is a chat, the way the window's first send
      // makes one: a record of its own, named for the words it opens with.
      const chatSession =
        kind === "orchestrator" ? StoreId.newSessionId() : undefined;
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
            initialSettings: {
              kind,
              name: initialTaskName,
              projectId: projectId ?? undefined,
            },
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

        // What the project said at the moment this task took its folders on.
        // Recorded here rather than left to the next message, because a folder
        // detached before that message would otherwise read as one the project
        // had just added and come straight back.
        await setTaskState(taskDir(taskId), {
          projectFolderBaseline: Object.fromEntries(
            project.folders.map((folder) => [folder.path, folder.access]),
          ),
        });
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
          agentName: await agentNameForTask(taskId),
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
  backgroundProcesses: taskBackgroundProcesses,
  byId,
  create,
  exportZip,
  files: taskFiles,
  import: importTask,
  list,
  live: {
    ...live,
    activity: liveTaskActivity,
    usageSummary: liveUsageSummary,
  },
  state: taskState,
  usageSummary,
};
