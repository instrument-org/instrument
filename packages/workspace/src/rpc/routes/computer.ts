import { z } from "zod";

import {
  ComputerListingSchema,
  computerPlaces,
  ComputerPlacesSchema,
  ComputerRecentSchema,
  listComputerFolder,
  recentComputerFiles,
} from "../../lib/orchestrator/computer";
import { TaskIdSchema } from "../../schemas/task-id";
import { base } from "../base";

/**
 * One folder of the computer as the person browsing sees it, with whether the
 * orchestrator `id` can reach it.
 */
const list = base
  .input(z.object({ id: TaskIdSchema, path: z.string() }))
  .output(ComputerListingSchema)
  .handler(({ input }) =>
    listComputerFolder({ path: input.path, taskId: input.id }),
  );

/** The folders the computer is entered from, and its volumes. */
const places = base
  .output(ComputerPlacesSchema)
  .handler(() => computerPlaces());

/**
 * The files changed most recently in those folders, newest first, each with
 * whether the orchestrator `id` can reach it.
 */
const recents = base
  .input(z.object({ id: TaskIdSchema }))
  .output(ComputerRecentSchema.array())
  .handler(({ input }) => recentComputerFiles({ taskId: input.id }));

export const computer = {
  list,
  places,
  recents,
};
