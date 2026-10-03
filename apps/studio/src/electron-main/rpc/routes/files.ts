import {
  findInTrash,
  type Identity,
  identityOf,
  type NewJournalEntry,
  undoEntry,
  UndoRefusedError,
} from "@/electron-main/lib/file-journal";
import { utf8Text } from "@/electron-main/lib/utf8-text";
import { watchHostFile } from "@/electron-main/lib/watch-host-file";
import { base } from "@/electron-main/rpc/base";
import { getFileJournal } from "@/electron-main/stores/machine/file-journal";
import { eventIterator, ORPCError } from "@orpc/server";
import { shell } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * What the person browsing their own computer can do to it, as the Finder
 * would: make a folder, rename one thing, duplicate it, put it in the trash.
 * These are the user's own actions on their own files, taken from the folder
 * they are looking at, so nothing here is gated by what the agent may reach.
 * Deleting is `shell.trashItem`, which is undoable in the Finder; no route
 * here unlinks anything. Each action is written to the file journal before it
 * answers, so `undo` can take it back.
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

/**
 * A place on this computer, spelled the way the filesystem spells one. Nothing
 * here expands `~` or resolves against a working directory, so a path that
 * arrives as either names somewhere nobody meant and is refused at the door.
 */
const HostPathSchema = z.string().refine((value) => path.isAbsolute(value), {
  message: "Not a path on this computer",
});

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
  .input(z.object({ parent: HostPathSchema }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    try {
      const made = await freePath(input.parent, UNTITLED);
      await fs.mkdir(made);
      await record(made, (identity) => ({
        identity,
        kind: "new-folder",
        made,
      }));
      return { path: made };
    } catch (error) {
      throw errors.CANNOT_WRITE({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

const rename = base
  .errors(NAME_ERRORS)
  .input(z.object({ name: z.string(), path: HostPathSchema }))
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
    // A name taken by something else is refused. One that differs only in
    // letter case finds the item itself there on a disk that does not tell
    // them apart, and is a rename like any other.
    const there = await identityOf(moved);
    const self = await identityOf(input.path);
    if (there && !(self && there.dev === self.dev && there.ino === self.ino)) {
      throw errors.NAME_IN_USE();
    }
    await fs.rename(input.path, moved);
    await record(moved, (identity) => ({
      from: input.path,
      identity,
      kind: "rename",
      to: moved,
    }));
    return { path: moved };
  });

const duplicate = base
  .errors({ CANNOT_WRITE: { message: "That folder cannot be written to" } })
  .input(z.object({ path: HostPathSchema }))
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
      await record(copy, (identity) => ({
        identity,
        kind: "duplicate",
        made: copy,
      }));
      return { path: copy };
    } catch (error) {
      throw errors.CANNOT_WRITE({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

const trash = base
  .errors({ CANNOT_TRASH: { message: "That could not be moved to the trash" } })
  .input(z.object({ path: HostPathSchema }))
  .handler(async ({ errors, input }) => {
    const identity = await identityOf(input.path);
    try {
      await shell.trashItem(input.path);
    } catch (error) {
      throw errors.CANNOT_TRASH({
        message: error instanceof Error ? error.message : undefined,
      });
    }
    // The Trash keeps no record of where a thing came from that an app can
    // read, so where it landed is found by its identity now, while it is
    // still the newest thing there.
    if (identity) {
      getFileJournal().record({
        from: input.path,
        identity,
        kind: "trash",
        trashed: await findInTrash(identity),
      });
    }
  });

/** Writes an action to the journal, by the identity of what it left at `at`. */
async function record(
  at: string,
  entry: (identity: Identity) => NewJournalEntry,
) {
  const identity = await identityOf(at);
  if (identity) {
    getFileJournal().record(entry(identity));
  }
}

/**
 * Takes back the newest action in the journal: a rename, a duplicate, a new
 * folder, or a move to the Trash. One that cannot be taken back safely is
 * refused with the reason and stays in the journal, so nothing older is
 * undone out of order behind it.
 */
const undo = base
  .errors({
    CANNOT_UNDO: { message: "That cannot be undone" },
    NOTHING_TO_UNDO: { message: "There is nothing to undo" },
  })
  .output(
    z.object({
      kind: z.enum(["duplicate", "new-folder", "rename", "trash"]),
      /** Whether what was put back is a folder. */
      isFolder: z.boolean(),
      /** Where the thing is now, for whatever was put back rather than removed. */
      path: z.string().nullable(),
    }),
  )
  .handler(async ({ errors }) => {
    const journal = getFileJournal();
    const entry = journal.latest();
    if (!entry) {
      throw errors.NOTHING_TO_UNDO();
    }
    try {
      const restored = await undoEntry(entry, {
        trash: (at) => shell.trashItem(at),
      });
      journal.remove(entry.id);
      const isFolder =
        restored !== null &&
        (await fs.lstat(restored).then(
          (stats) => stats.isDirectory(),
          () => false,
        ));
      return { isFolder, kind: entry.kind, path: restored };
    } catch (error) {
      throw errors.CANNOT_UNDO({
        message: error instanceof UndoRefusedError ? error.message : undefined,
      });
    }
  });

/** A short fingerprint of a file's text, so a writer can say which version it edited. */
function versionOf(text: string) {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/**
 * Writes a file whole or not at all: into a new file beside it, then renamed
 * over it, so a crash or a full disk mid-write leaves the old text rather
 * than half of the new. The file keeps its permissions, and a link is
 * written through to the file it points at.
 */
async function writeWhole(filePath: string, content: string) {
  const target = await fs.realpath(filePath).catch(() => filePath);
  const mode = await fs.stat(target).then(
    (stats) => stats.mode & 0o7777,
    () => null,
  );
  const staging = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID().slice(0, 8)}.tmp`,
  );
  try {
    await fs.writeFile(staging, content);
    if (mode !== null) {
      await fs.chmod(staging, mode);
    }
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { force: true });
    throw error;
  }
}

/**
 * Each file's writes in turn, keyed by the file a link resolves to, so two
 * editors holding the same version cannot both pass the check before either
 * lands: the second sees the first's text and gets it back to merge. This
 * orders the app's own writers only; anything else writing the file can
 * still slip in between.
 */
const writeChains = new Map<string, Promise<unknown>>();

async function oneWriterAt<T>(filePath: string, work: () => Promise<T>) {
  const key = await fs.realpath(filePath).catch(() => path.resolve(filePath));
  const run = (writeChains.get(key) ?? Promise.resolve()).then(work, work);
  const settled = run.catch(() => {
    // The caller hears the failure through `run`; the next write still goes.
  });
  writeChains.set(key, settled);
  void settled.then(() => {
    if (writeChains.get(key) === settled) {
      writeChains.delete(key);
    }
  });
  return run;
}

/**
 * The person's own edit to a text file they have open, written only when the
 * file on disk is still the version the editor started from. When the agent
 * (or anything else) wrote in between, nothing is written and the current text
 * comes back, so the editor can merge it and try again.
 */
const write = base
  .errors({
    CANNOT_WRITE: { message: "That file cannot be written to" },
    NOT_UTF8: {
      message: "This file is not UTF-8 text, so it is not saved here",
    },
  })
  .input(
    z.object({
      baseVersion: z.string().optional(),
      content: z.string(),
      path: HostPathSchema,
    }),
  )
  .output(
    z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), version: z.string() }),
      z.object({
        content: z.string(),
        ok: z.literal(false),
        version: z.string(),
      }),
    ]),
  )
  .handler(async ({ errors, input }) => {
    try {
      return await oneWriterAt(input.path, async () => {
        // A write with no version to check creates the file when it is not
        // there; one with a version needs the file it edited.
        const bytes =
          input.baseVersion === undefined
            ? await fs.readFile(input.path).catch(() => null)
            : await fs.readFile(input.path);
        // Text in another encoding came to the editor with its unreadable
        // bytes replaced, so saving it would replace them on disk too.
        const disk = bytes ? utf8Text(bytes) : null;
        if (bytes && disk === null) {
          throw errors.NOT_UTF8();
        }
        if (input.baseVersion !== undefined && disk !== null) {
          const diskVersion = versionOf(disk);
          if (diskVersion !== input.baseVersion) {
            return { content: disk, ok: false as const, version: diskVersion };
          }
        }
        await writeWhole(input.path, input.content);
        return { ok: true as const, version: versionOf(input.content) };
      });
    } catch (error) {
      if (error instanceof ORPCError && error.code === "NOT_UTF8") {
        throw error;
      }
      throw errors.CANNOT_WRITE({
        message: error instanceof Error ? error.message : undefined,
      });
    }
  });

/**
 * A text file's contents and version, for an editor that will write it back.
 * A file that is not UTF-8 still reads, its unreadable bytes replaced, with
 * `utf8` false so the editor opens it read only: `write` refuses it.
 */
const read = base
  .input(z.object({ path: HostPathSchema }))
  .output(
    z.object({ content: z.string(), utf8: z.boolean(), version: z.string() }),
  )
  .handler(async ({ input }) => {
    const bytes = await fs.readFile(input.path);
    const strict = utf8Text(bytes);
    const content = strict ?? bytes.toString("utf8");
    return { content, utf8: strict !== null, version: versionOf(content) };
  });

const live = {
  /** One file on this computer, watched while something is looking at it: when it was last written, or null while it is not there. */
  info: base
    .input(
      z.object({
        /** How often to look, for a viewer that wants changes sooner than the default second; floored at 200 ms. */
        intervalMs: z.number().optional(),
        path: HostPathSchema,
      }),
    )
    .output(eventIterator(z.object({ modifiedAt: z.number() }).nullable()))
    .handler(async function* ({ input, signal }) {
      yield* watchHostFile({
        ...(input.intervalMs === undefined
          ? {}
          : { intervalMs: Math.max(200, input.intervalMs) }),
        path: input.path,
        signal,
      });
    }),
};

export const files = {
  duplicate,
  live,
  newFolder,
  read,
  rename,
  trash,
  undo,
  write,
};
