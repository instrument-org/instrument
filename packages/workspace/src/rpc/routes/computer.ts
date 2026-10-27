import { z } from "zod";

import {
  computerDrives,
  ComputerDriveSchema,
  computerPlaces,
  ComputerPlacesSchema,
} from "../../lib/chat/computer-places";
import {
  ComputerFileEntrySchema,
  ComputerFolderSchema,
  describeComputerFiles,
  listComputerFolder,
} from "../../lib/chat/computer";
import { computerFileTitles } from "../../lib/chat/computer-titles";
import {
  LocatedPathSchema,
  locateComputerPath,
} from "../../lib/chat/locate-computer-path";
import { ChatIdSchema } from "../../schemas/chat-id";
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
  .input(z.object({ id: ChatIdSchema, path: z.string() }))
  .output(ComputerFolderSchema)
  .handler(async ({ errors, input }) => {
    try {
      return await listComputerFolder({ path: input.path, chatId: input.id });
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

/**
 * What is at a path a person typed or pasted into an address field, asked
 * when they press Return rather than as they type, since the first read of a
 * protected folder is the moment the system asks about it.
 */
const locate = base
  .input(z.object({ path: z.string() }))
  .output(LocatedPathSchema)
  .handler(({ input }) => locateComputerPath(input.path));

/** The folders the computer is entered from, and its volumes. */
const places = base
  .output(ComputerPlacesSchema)
  .handler(() => computerPlaces());

/** The disks, with how much of each is free. */
const drives = base
  .output(ComputerDriveSchema.array())
  .handler(() => computerDrives());

/**
 * Files by host path, in the order asked, each with whether the chat `id`
 * can reach it. Paths no longer there, or no longer files, are left out.
 */
const describe = base
  .input(z.object({ id: ChatIdSchema, paths: z.array(z.string()) }))
  .output(ComputerFileEntrySchema.array())
  .handler(({ input }) =>
    describeComputerFiles({ chatId: input.id, paths: input.paths }),
  );

/**
 * The titles the pages among `paths` give themselves, by host path, for a
 * folder listed by them; a file with none, or not on this computer's disk, is
 * left out.
 */
const titles = base
  .input(z.object({ paths: z.array(z.string()).max(5000) }))
  .output(z.record(z.string(), z.string()))
  .handler(({ input }) => computerFileTitles(input.paths));

export const computer = {
  describe,
  drives,
  list,
  locate,
  places,
  titles,
};
