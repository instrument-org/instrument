import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  addFolderToProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  removeFolderFromProject,
  setProjectFolderAccess,
  updateProject,
} from "../../../lib/project";
import { updateTaskSettings } from "../../../lib/task-settings";
import { FolderAttachment } from "../../../schemas/folder-attachment";
import { ProjectFolderSchema, ProjectSchema } from "../../../schemas/project";
import { ProjectIdSchema } from "../../../schemas/project-id";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

const list = base
  .output(ProjectSchema.array())
  .handler(async () => listProjects());

const byId = base
  .input(z.object({ id: ProjectIdSchema }))
  .output(ProjectSchema)
  .handler(async ({ errors, input }) => {
    const result = await getProject(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    return result.value;
  });

const create = base
  .input(
    z.object({
      description: z.string().optional(),
      folders: z.array(ProjectFolderSchema).optional(),
      instructions: z.string().optional(),
      name: z.string(),
    }),
  )
  .output(ProjectSchema)
  .handler(async ({ context, errors, input }) => {
    const result = await createProject(input);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    context.workspaceConfig.captureEvent("project.created");
    return result.value;
  });

const update = base
  .input(
    z.object({
      description: z.string().optional(),
      id: ProjectIdSchema,
      instructions: z.string().optional(),
      name: z.string().optional(),
    }),
  )
  .output(ProjectSchema)
  .handler(async ({ errors, input: { id, ...updates } }) => {
    const result = await updateProject(id, updates);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    return result.value;
  });

const remove = base
  .input(z.object({ id: ProjectIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const result = await deleteProject(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    // deleteProject calls updateTaskSettings per task, which emits task.updated.
    publisher.publish("project.updated", null);
    context.workspaceConfig.captureEvent("project.removed");
  });

const addTask = base
  .input(z.object({ projectId: ProjectIdSchema, taskId: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const projectResult = await getProject(input.projectId);
    if (projectResult.isErr()) {
      throw toORPCError(projectResult.error, errors);
    }
    const result = await updateTaskSettings(input.taskId, {
      projectId: input.projectId,
    });
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    context.workspaceConfig.captureEvent("project.task_added");
  });

const removeTask = base
  .input(z.object({ taskId: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const result = await updateTaskSettings(input.taskId, { projectId: null });
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    context.workspaceConfig.captureEvent("project.task_removed");
  });

const addFolder = base
  .input(
    z.object({
      access: FolderAttachment.AccessSchema,
      id: ProjectIdSchema,
      path: z.string(),
    }),
  )
  .output(ProjectSchema)
  .handler(async ({ errors, input }) => {
    const result = await addFolderToProject(input.id, input.path, input.access);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    return result.value;
  });

const setFolderAccess = base
  .input(
    z.object({
      access: FolderAttachment.AccessSchema,
      id: ProjectIdSchema,
      path: z.string(),
    }),
  )
  .output(ProjectSchema)
  .handler(async ({ errors, input }) => {
    const result = await setProjectFolderAccess(
      input.id,
      input.path,
      input.access,
    );
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    return result.value;
  });

const removeFolder = base
  .input(z.object({ id: ProjectIdSchema, path: z.string() }))
  .output(ProjectSchema)
  .handler(async ({ errors, input }) => {
    const result = await removeFolderFromProject(input.id, input.path);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("project.updated", null);
    return result.value;
  });

// Triggers live.list to re-read disk; for AGENTS.md edits made outside the app
// (no project.updated fires for external writes).
const refresh = base.output(z.void()).handler(() => {
  publisher.publish("project.updated", null);
});

const live = {
  list: base
    .output(eventIterator(ProjectSchema.array()))
    .handler(async function* ({ context, signal }) {
      yield call(list, undefined, { context, signal });

      const projectUpdated = publisher.subscribe("project.updated", { signal });

      for await (const _payload of projectUpdated) {
        yield call(list, undefined, { context, signal });
      }
    }),
};

export const project = {
  addFolder,
  addTask,
  byId,
  create,
  list,
  live,
  refresh,
  remove,
  removeFolder,
  removeTask,
  setFolderAccess,
  update,
};
