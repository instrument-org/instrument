import { z } from "zod";

import {
  ComputerFolderSchema,
  computerPlaces,
  ComputerPlacesSchema,
  ComputerRecentSchema,
  listComputerFolder,
  recentComputerFiles,
} from "../../lib/chat/computer";
import { TaskIdSchema } from "../../schemas/task-id";
import { base } from "../base";

/**
 * One folder of the computer as the person browsing sees it, with whether the
 * chat `id` can reach it.
 *
 * A folder the operating system will not let this app read is an answer
 * rather than a failure, and comes back as one, saying who refused: on a Mac
 * the first read of a protected folder is the moment the system asks, and a
 * refusal there is silent from then on, so every screen that lists a folder
 * has to say what happened and where it is undone. A path that names a file
 * is its own answer too: a typed path is asked for as a folder to
 * learn whether it is one, and the caller opens a file for that answer. So is
 * a path with nothing at it, which is what a path still being typed often is.
 */
const list = base
  .errors({
    NOT_A_FOLDER: {
      data: z.object({ path: z.string() }),
      message: "The path names a file, not a folder",
    },
    NOT_FOUND: {
      data: z.object({ path: z.string() }),
      message: "Nothing is at the path",
    },
  })
  .input(z.object({ id: TaskIdSchema, path: z.string() }))
  .output(ComputerFolderSchema)
  .handler(async ({ errors, input }) => {
    try {
      return await listComputerFolder({ path: input.path, taskId: input.id });
    } catch (error) {
      if (errorCode(error) === "ENOTDIR") {
        throw errors.NOT_A_FOLDER({ data: { path: input.path } });
      }
      if (errorCode(error) === "ENOENT") {
        throw errors.NOT_FOUND({ data: { path: input.path } });
      }
      throw error;
    }
  });

/** The system error code a failed read carries, if it carries one. */
function errorCode(error: unknown) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/** The folders the computer is entered from, and its volumes. */
const places = base
  .output(ComputerPlacesSchema)
  .handler(() => computerPlaces());

/**
 * The files the chats have shown the user, newest first, each with whether
 * the chat that showed it can still reach it.
 */
const recents = base
  .output(ComputerRecentSchema.array())
  .handler(() => recentComputerFiles());

export const computer = {
  list,
  places,
  recents,
};
