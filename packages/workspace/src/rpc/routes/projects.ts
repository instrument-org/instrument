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
import { watchFolder } from "../../lib/folder-watch";
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

/** The conversation's projects: in use first, in the order made, then retired. */
const listProjectsRoute = base
  .output(ListedProjectSchema.array())
  .handler(() => listProjects());

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

export const projects = {
  create: createProjectRoute,
  events: { changed: changedProjectsRoute },
  list: listProjectsRoute,
  retire: retireProjectRoute,
  update: updateProjectRoute,
};
