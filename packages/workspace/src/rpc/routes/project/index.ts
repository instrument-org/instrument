import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  addFolderToProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  removeFolderFromProject,
  updateProject,
} from "../../../lib/project";
import { updateTaskSettings } from "../../../lib/task-settings";
import { ProjectSchema } from "../../../schemas/project";
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
      folders: z.array(z.string()).optional(),
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
      folders: z.array(z.string()).optional(),
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
    // deleteProject unfiles member tasks via updateTaskSettings, which already
    // emits per-task `task.updated` to refresh task-derived views.
    publisher.publish("project.updated", null);
    context.workspaceConfig.captureEvent("project.removed");
  });

const addTask = base
  .input(z.object({ projectId: ProjectIdSchema, taskId: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
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
  .input(z.object({ id: ProjectIdSchema, path: z.string() }))
  .output(ProjectSchema)
  .handler(async ({ errors, input }) => {
    const result = await addFolderToProject(input.id, input.path);
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
  remove,
  removeFolder,
  removeTask,
  update,
};
