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
 *
 * A folder the operating system will not let this app read is its own
 * answer rather than a failure: on a Mac the first read of a protected folder
 * is the moment the system asks, and a refusal there is silent from then on,
 * so the screen has to say what happened and where it is undone.
 */
const list = base
  .errors({
    NOT_PERMITTED: {
      data: z.object({ path: z.string() }),
      message: "The operating system has not let this app read the folder",
    },
  })
  .input(z.object({ id: TaskIdSchema, path: z.string() }))
  .output(ComputerListingSchema)
  .handler(async ({ errors, input }) => {
    try {
      return await listComputerFolder({ path: input.path, taskId: input.id });
    } catch (error) {
      if (isPermissionError(error)) {
        throw errors.NOT_PERMITTED({ data: { path: input.path } });
      }
      throw error;
    }
  });

/** A read the operating system refused, as opposed to a folder that is not there. */
function isPermissionError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES")
  );
}

/** The folders the computer is entered from, and its volumes. */
const places = base
  .output(ComputerPlacesSchema)
  .handler(() => computerPlaces());

/**
 * The files the orchestrator `id` has shown the user, newest first, each with
 * whether it can still reach it.
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
