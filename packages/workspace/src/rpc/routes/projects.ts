import { eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  createProject,
  ListedProjectSchema,
  listProjects,
  retireProject,
  PROJECT_NAME_MAX,
  ProjectFolderSchema,
  ProjectNameError,
  projectsDir,
  ProjectSchema,
  updateProject,
} from "../../lib/chat/projects";
import { undoProjectChanges } from "../../lib/chat/undo-project-changes";
import { watchFolder } from "../../lib/folder-watch";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { base } from "../base";
import { publisher } from "../publisher";

/** What the user picks about a project: its mark, its tint. */
const ProjectMarkSchema = z.object({
  color: z.string().max(9).optional(),
  emoji: z.string().max(8).optional(),
  /** A Phosphor icon's name, in place of an emoji. */
  icon: z.string().max(64).optional(),
});

const ProjectNameSchema = z
  .string()
  .min(1)
  .max(PROJECT_NAME_MAX * 2);

/**
 * A project as the menus, marks and filters name it. Its instructions (up to
 * 100k characters), the folders granted under it and the front matter this
 * build does not know are `get`'s, read where they are shown.
 */
const ProjectSummarySchema = ListedProjectSchema.pick({
  about: true,
  color: true,
  created: true,
  emoji: true,
  icon: true,
  id: true,
  name: true,
  retired: true,
  unsaved: true,
});

/**
 * The conversation's projects: in use first, in the order made, then retired.
 * The output schema leaves out what `ProjectSummarySchema` does not name.
 */
const listProjectsRoute = base
  .output(ProjectSummarySchema.array())
  .handler(() => listProjects());

/** One project whole, as its details show it; null for an id no project has. */
const getProjectRoute = base
  .input(z.object({ projectId: z.string() }))
  .output(ListedProjectSchema.nullable())
  .handler(async ({ input }) => {
    const projects = await listProjects();
    return projects.find((project) => project.id === input.projectId) ?? null;
  });

/** A name a project's folder cannot take, said back as a bad request. */
async function sayingNameErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProjectNameError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}

/** The standing words for work under a project; an empty string is none. */
const ProjectInstructionsSchema = z.string().max(100_000);

/**
 * Makes a project under a name, with its instructions and the folders granted
 * under it, or returns the one already called that as it is when given only
 * the name. A name in use given instructions or folders is a bad request.
 */
const createProjectRoute = base
  .input(
    ProjectMarkSchema.extend({
      folders: z.array(ProjectFolderSchema).optional(),
      instructions: ProjectInstructionsSchema.optional(),
      name: ProjectNameSchema,
    }),
  )
  .output(ProjectSchema)
  .handler(({ input }) =>
    sayingNameErrors(() =>
      createProject({
        ...(input.color ? { color: input.color } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.folders ? { folders: input.folders } : {}),
        ...(input.instructions ? { instructions: input.instructions } : {}),
        name: input.name,
      }),
    ),
  );

/**
 * Changes what the user chose about a project: its name, which moves its
 * folder, its mark, its tint, its folders, and its instructions, which an
 * empty string takes away.
 */
const updateProjectRoute = base
  .input(
    ProjectMarkSchema.extend({
      folders: z.array(ProjectFolderSchema).optional(),
      instructions: ProjectInstructionsSchema.optional(),
      name: ProjectNameSchema.optional(),
      projectId: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    await sayingNameErrors(() =>
      updateProject(input.projectId, {
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.folders === undefined ? {} : { folders: input.folders }),
        ...(input.instructions === undefined
          ? {}
          : { instructions: input.instructions }),
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    );
  });

/** Takes a project out of the menus, leaving the chats that carry it alone. */
const retireProjectRoute = base
  .input(z.object({ projectId: z.string() }))
  .handler(async ({ input }) => {
    await retireProject(input.projectId);
  });

/**
 * A revision that moves whenever a project's folder changes on disk, whoever
 * changed it: the app, the agent, the person in their files. Opens with
 * revision 0, a point to re-read from, as `skill.events.changed` does.
 */
const changedProjectsRoute = base
  .output(eventIterator(z.object({ revision: z.number() })))
  .handler(async function* ({ signal }) {
    const changes = publisher.subscribe("project.changed", { signal });
    const stop = watchFolder(projectsDir(), {
      depth: 1,
      onChange: () => {
        publisher.publish("project.changed", null);
      },
    });
    let revision = 0;
    try {
      yield { revision };
      for await (const _ of changes) {
        revision += 1;
        yield { revision };
      }
    } finally {
      stop();
    }
  });

/**
 * Puts back what a turn's `instrument projects` commands changed, where each
 * project still has what the turn set.
 */
const undoProjectChangesRoute = base
  .input(
    z.object({
      changes: z.array(
        z.object({
          fields: z.array(SessionMessageDataPart.ProjectFieldChangeSchema),
          name: z.string(),
        }),
      ),
    }),
  )
  .output(z.object({ skipped: z.number(), undone: z.number() }))
  .handler(async ({ input }) => await undoProjectChanges(input.changes));

export const projects = {
  create: createProjectRoute,
  events: { changed: changedProjectsRoute },
  get: getProjectRoute,
  list: listProjectsRoute,
  retire: retireProjectRoute,
  undoChanges: undoProjectChangesRoute,
  update: updateProjectRoute,
};
