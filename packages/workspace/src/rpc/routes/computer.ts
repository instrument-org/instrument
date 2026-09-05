import { z } from "zod";

import {
  ComputerListingSchema,
  computerPlaces,
  ComputerPlacesSchema,
  listComputerFolder,
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

export const computer = {
  list,
  places,
};
