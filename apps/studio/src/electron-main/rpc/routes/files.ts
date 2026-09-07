import { base } from "@/electron-main/rpc/base";
import { shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * What the person browsing their own computer can do to it, as the Finder
 * would: make a folder, rename one thing, duplicate it, put it in the trash.
 * These are the user's own actions on their own files, taken from the folder
 * they are looking at, so nothing here is gated by what the agent may reach.
 * Deleting is `shell.trashItem`, which is undoable in the Finder; no route
 * here unlinks anything.
 */

/** The name the Finder gives a new folder, and how it counts the next one. */
const UNTITLED = "untitled folder";

/** Whether anything is at a path, without caring why not. */
function exists(at: string) {
  return fs.access(at).then(
    () => true,
    () => false,
  );
}

/**
 * A path in `parent` named `name`, made unique the way the Finder does: the
 * name, then the name and 2, then 3, up to a bound so a wedged loop cannot run
 * forever.
 */
async function freePath(parent: string, name: string, extension = "") {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(
      parent,
      n === 1 ? `${name}${extension}` : `${name} ${n}${extension}`,
    );
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error(`No free name for ${name} in ${parent}`);
}

const NAME_ERRORS = {
  NAME_IN_USE: { message: "Something with that name is already there" },
  NAME_INVALID: { message: "That name cannot be used" },
} as const;

/** A name a file can carry: one segment, nothing hidden by a leading dot. */
function isUsableName(name: string) {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith(".") &&
    !name.includes("/") &&
    !name.includes("\0")
  );
}

const newFolder = base
  .errors({ CANNOT_WRITE: { message: "That folder cannot be written to" } })
  .input(z.object({ parent: z.string() }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    try {
      const made = await freePath(input.parent, UNTITLED);
      await fs.mkdir(made);
      return { path: made };
    } catch (error) {
      throw errors.CANNOT_WRITE({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

const rename = base
  .errors(NAME_ERRORS)
  .input(z.object({ name: z.string(), path: z.string() }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const name = input.name.trim();
    if (!isUsableName(name)) {
      throw errors.NAME_INVALID();
    }
    const moved = path.join(path.dirname(input.path), name);
    if (moved === input.path) {
      return { path: moved };
    }
    if (await exists(moved)) {
      throw errors.NAME_IN_USE();
    }
    await fs.rename(input.path, moved);
    return { path: moved };
  });

const duplicate = base
  .errors({ CANNOT_WRITE: { message: "That folder cannot be written to" } })
  .input(z.object({ path: z.string() }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    // The Finder's naming: `notes copy.txt`, then `notes copy 2.txt`, with the
    // extension kept on the end where the Mac expects to find it.
    const extension = path.extname(input.path);
    const stem = path.basename(input.path, extension);
    try {
      const copy = await freePath(
        path.dirname(input.path),
        `${stem} copy`,
        extension,
      );
      await fs.cp(input.path, copy, { recursive: true });
      return { path: copy };
    } catch (error) {
      throw errors.CANNOT_WRITE({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

const trash = base
  .errors({ CANNOT_TRASH: { message: "That could not be moved to the trash" } })
  .input(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    try {
      await shell.trashItem(input.path);
    } catch (error) {
      throw errors.CANNOT_TRASH({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

export const files = {
  duplicate,
  newFolder,
  rename,
  trash,
};
