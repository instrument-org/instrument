import { getHistoryStore } from "@/electron-main/browser-view/history-store";
import {
  fileJournal,
  findInTrash,
  type Identity,
  identityOf,
  type NewJournalEntry,
  undoEntry,
  UndoRefusedError,
} from "@/electron-main/lib/file-journal";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { pathWithin } from "@/electron-main/lib/path-identity";
import {
  executePlacing,
  fileSystemOps,
  type InTrash,
} from "@/electron-main/lib/finder-placing/execute";
import { gatherPlaceRequest } from "@/electron-main/lib/finder-placing/gather";
import {
  clashesOf,
  planPlacing,
} from "@/electron-main/lib/finder-placing/plan";
import {
  createLeftovers,
  finishLeftovers,
} from "@/electron-main/lib/finder-placing/leftovers";
import {
  trashItem as nativeTrashItem,
  pasteboardFiles,
  resolveAlias,
} from "@/electron-main/lib/mac-native";
import {
  isRefusedByName,
  isRefusedFile,
} from "@/electron-main/lib/refused-files";
import { openPathOnComputer } from "@/electron-main/lib/open-path";
import { utf8Text } from "@/electron-main/lib/utf8-text";
import { watchHostFile } from "@/electron-main/lib/watch-host-file";
import { base } from "@/electron-main/rpc/base";
import {
  allowThroughProtection as allowProgramsThroughProtection,
  confirmedBlock,
} from "@instrument-org/workspace/electron";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { getMachineState } from "@/electron-main/stores/machine/state";
import { copyName, newFolderName, osOf } from "@/shared/os-conventions";
import { isProtectedFolder } from "@/shared/protected-folders";
import { moveSidebarPlaces } from "@/shared/sidebar-places";
import { resolveThroughAliases } from "@instrument-org/workspace/electron";
import { eventIterator, ORPCError } from "@orpc/server";
import { clipboard, ClipboardItem, shell, webContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

/** The system this runs on, whose file manager names new folders and copies. */
const OS = osOf(process.platform);

/** Whether anything is at a path, without caring why not. */
function exists(at: string) {
  return fs.access(at).then(
    () => true,
    () => false,
  );
}

/**
 * The first free path in `parent` among the names `nameFor` counts out, the
 * way the system's file manager counts them (`os-conventions.ts`), up to a
 * bound so a wedged loop cannot run forever.
 */
async function freePath(
  parent: string,
  nameFor: (n: number) => string,
  extension = "",
) {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(parent, `${nameFor(n)}${extension}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error(`No free name for ${nameFor(1)} in ${parent}`);
}

/**
 * A place on this computer, spelled the way the filesystem spells one. Nothing
 * here expands `~` or resolves against a working directory, so a path that
 * arrives as either names somewhere nobody meant and is refused at the door.
 */
const HostPathSchema = z.string().refine((value) => path.isAbsolute(value), {
  message: "Not a path on this computer",
});

/**
 * Refused to every action here but making a folder: the folders the system
 * keeps (`isProtectedFolder`), and the workspace's own folder or one around
 * it, which the app is running from. Checked here as well as in the menus,
 * so a press that reaches a route the person did not mean to still changes
 * nothing. A link is only a link, and goes wherever it points.
 */
const PROTECTED_ERRORS = {
  PROTECTED: {
    message:
      "That’s one of your computer’s own folders, so Instrument leaves it alone.",
  },
} as const;

/**
 * Why a path is left alone, as the person reads it, or undefined when it may
 * change. It is judged as spelled and as reached, the folders above it (and
 * the home folder) followed through their links (`/Volumes/Macintosh HD` is the boot disk's
 * top), while the last name stays itself: a link is only a link.
 */
async function keptInPlace(asked: string): Promise<string | undefined> {
  const at = path.resolve(asked);
  const reached = await fs.realpath(path.dirname(at)).then(
    (folder) => path.join(folder, path.basename(at)),
    () => at,
  );
  const home = os.homedir();
  const reachedHome = await fs.realpath(home).catch(() => home);
  if (
    isProtectedFolder(at, { home, os: OS }) ||
    isProtectedFolder(reached, { home: reachedHome, os: OS })
  ) {
    return PROTECTED_ERRORS.PROTECTED.message;
  }
  const isLink = await fs.lstat(at).then(
    (stats) => stats.isSymbolicLink(),
    () => false,
  );
  return !isLink && pathWithin(getWorkspaceFolder(), at)
    ? "Instrument keeps its workspace in that folder, so it leaves it alone."
    : undefined;
}

const NAME_ERRORS = {
  NAME_IN_USE: { message: "Something with that name is already there" },
  NAME_INVALID: { message: "That name cannot be used" },
} as const;

/**
 * Windows' ransomware protection kept the app out of a folder it guards,
 * which the write itself reports as a missing file: the folder, and the
 * programs to let through for it.
 */
const PROTECTION_ERRORS = {
  WINDOWS_PROTECTION: {
    data: z.object({ folder: z.string(), programs: z.array(z.string()) }),
    message: "Windows is keeping Instrument out of that folder",
  },
} as const;

/**
 * Runs a write into `target`, and when it fails says whether Windows'
 * ransomware protection is what refused it, by the block Defender logs for
 * one of the app's programs there: `blocked` with the folder and
 * programs, or the failure as it was.
 */
async function writeOrBlock<T>(
  target: string,
  write: () => Promise<T>,
): Promise<
  | { blocked: { folder: string; programs: string[] }; ok: false }
  | { error: unknown; ok: false }
  | { ok: true; value: T }
> {
  const since = new Date();
  try {
    return { ok: true, value: await write() };
  } catch (error) {
    const blocked = await confirmedBlock(target, since).catch(() => undefined);
    return blocked ? { blocked, ok: false } : { error, ok: false };
  }
}

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
  .errors({
    CANNOT_WRITE: { message: "That folder cannot be written to" },
    ...PROTECTION_ERRORS,
  })
  .input(z.object({ parent: HostPathSchema }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const made = await writeOrBlock(input.parent, async () => {
      const folder = await freePath(input.parent, (n) => newFolderName(OS, n));
      await fs.mkdir(folder);
      return folder;
    });
    if (!made.ok) {
      if ("blocked" in made) {
        throw errors.WINDOWS_PROTECTION({ data: made.blocked });
      }
      throw errors.CANNOT_WRITE({
        message: made.error instanceof Error ? made.error.message : undefined,
      });
    }
    await record(made.value, (identity) => ({
      identity,
      kind: "new-folder",
      made: made.value,
    }));
    return { path: made.value };
  });

const rename = base
  .errors({ ...NAME_ERRORS, ...PROTECTED_ERRORS, ...PROTECTION_ERRORS })
  .input(z.object({ name: z.string(), path: HostPathSchema }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const kept = await keptInPlace(input.path);
    if (kept) {
      throw errors.PROTECTED({ message: kept });
    }
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
    const renamed = await writeOrBlock(moved, () =>
      fs.rename(input.path, moved),
    );
    if (!renamed.ok) {
      if ("blocked" in renamed) {
        throw errors.WINDOWS_PROTECTION({ data: renamed.blocked });
      }
      throw renamed.error;
    }
    followMove(input.path, moved);
    await record(moved, (identity) => ({
      from: input.path,
      identity,
      kind: "rename",
      to: moved,
    }));
    return { path: moved };
  });

const duplicate = base
  .errors({
    CANNOT_WRITE: { message: "That folder cannot be written to" },
    ...PROTECTED_ERRORS,
    ...PROTECTION_ERRORS,
  })
  .input(z.object({ path: HostPathSchema }))
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const kept = await keptInPlace(input.path);
    if (kept) {
      throw errors.PROTECTED({ message: kept });
    }
    // Named the way the system's file manager names a copy, with the
    // extension kept on the end where every system expects to find it.
    const extension = path.extname(input.path);
    const stem = path.basename(input.path, extension);
    const copied = await writeOrBlock(path.dirname(input.path), async () => {
      const copy = await freePath(
        path.dirname(input.path),
        (n) => copyName(OS, stem, n),
        extension,
      );
      await fs.cp(input.path, copy, { recursive: true });
      return copy;
    });
    if (!copied.ok) {
      if ("blocked" in copied) {
        throw errors.WINDOWS_PROTECTION({ data: copied.blocked });
      }
      throw errors.CANNOT_WRITE({
        message:
          copied.error instanceof Error ? copied.error.message : undefined,
      });
    }
    await record(copied.value, (identity) => ({
      identity,
      kind: "duplicate",
      made: copied.value,
    }));
    return { path: copied.value };
  });

/**
 * What a Replace displaces, moved to the Trash, and where it landed when the
 * system says: the Mac's own call answers that, which reading the Trash could
 * not without Full Disk Access.
 */
async function trashReplaced(at: string): Promise<InTrash> {
  const landed = await nativeTrashItem(at);
  if (landed !== undefined) {
    return { inTrash: landed };
  }
  await shell.trashItem(at);
  return { inTrash: null };
}

/** What placing and its undo leave under names of their own until each is done with, kept in the machine's state. */
const placingLeftovers = createLeftovers({
  read: () => getMachineState().get("placingLeftovers") ?? [],
  write: (leftovers) => {
    getMachineState().set("placingLeftovers", [...leftovers]);
  },
});

/** Finishes what a quit or crash left mid-placing: once, at launch. */
export function finishPlacingLeftovers() {
  return finishLeftovers(placingLeftovers, {
    identity: identityOf,
    trash: (at) => shell.trashItem(at),
  });
}

const ClashSchema = z.object({
  kind: z.enum(["file", "folder", "link", "package"]),
  name: z.string(),
  path: z.string(),
  replaceable: z.boolean(),
  with: z.object({
    by: z.enum(["entry", "source"]),
    identity: z.object({ dev: z.number(), ino: z.string() }),
    kind: z.enum(["file", "folder", "link", "package"]),
  }),
});

const PlaceInputSchema = z.object({
  folder: HostPathSchema,
  paths: z.array(HostPathSchema).min(1).max(1000),
  /** The person's answer for each clash, by the source's path. */
  resolutions: z
    .record(z.string(), z.enum(["keepBoth", "replace", "skip"]))
    .optional(),
  /** For each source answered Replace, the identity of what the person was shown in its way. */
  replacing: z
    .record(z.string(), z.object({ dev: z.number(), ino: z.string() }))
    .optional(),
});

/**
 * Copies things into a folder (a drop from outside the app, or a paste), or
 * moves the Finder's own rows into one (a drop of them): read, planned and
 * carried out by `finder-placing`, where the rules and their invariants are.
 * What was done is one journal entry, so one ⌘Z takes all of it back.
 */
function placeRoute(op: "copy" | "move") {
  return base
    .errors({
      CANNOT_PLACE: { message: "That couldn’t be done" },
      ...PROTECTED_ERRORS,
    })
    .input(PlaceInputSchema)
    .output(
      z.object({
        /** Why it stopped short, and what that left where; null when it did all of it. */
        failure: z.string().nullable(),
        /** What kept it out when Windows' ransomware protection did: the folder and the programs to let through. */
        protection: z
          .object({ folder: z.string(), programs: z.array(z.string()) })
          .nullable(),
        /** The journal entry that takes all of it back, when anything changed. */
        journalId: z.string().nullable(),
        placed: z.array(
          z.object({
            from: z.string(),
            how: z.enum(["copied", "moved"]),
            path: z.string(),
            replaced: z.boolean(),
          }),
        ),
        skipped: z.array(
          z.object({
            source: z.string(),
            why: z.enum(["already-there", "answered", "changed"]),
          }),
        ),
        /** What a Replace moved to the Trash, and where it landed when the system said. */
        trashed: z.array(
          z.object({ from: z.string(), inTrash: z.string().nullable() }),
        ),
      }),
    )
    .handler(async ({ errors, input }) => {
      // What a move takes away, and what a Replace puts in the Trash.
      const displaced = input.paths.flatMap((source) => [
        ...(op === "move" ? [source] : []),
        ...(input.resolutions?.[source] === "replace"
          ? [path.join(input.folder, path.basename(source))]
          : []),
      ]);
      for (const at of displaced) {
        const kept = await keptInPlace(at);
        if (kept) {
          throw errors.PROTECTED({ message: kept });
        }
      }
      const plan = planPlacing(
        await gatherPlaceRequest({
          answers: input.resolutions ?? {},
          folder: input.folder,
          op,
          paths: input.paths,
          ...(input.replacing ? { replacing: input.replacing } : {}),
        }),
      );
      if ("refusal" in plan) {
        throw errors.CANNOT_PLACE({ message: plan.refusal });
      }
      const since = new Date();
      const outcome = await executePlacing(
        op,
        plan.steps,
        fileSystemOps({ leftovers: placingLeftovers, trash: trashReplaced }),
      );
      const protection = outcome.failure
        ? ((await confirmedBlock(input.folder, since).catch(() => undefined)) ??
          null)
        : null;
      for (const each of outcome.placed) {
        if (each.how === "moved") {
          followMove(each.from, each.path);
        }
      }
      return {
        failure: outcome.failure,
        journalId: outcome.journal
          ? fileJournal.record(outcome.journal).id
          : null,
        placed: outcome.placed,
        protection,
        skipped: outcome.skipped,
        trashed: outcome.trashed,
      };
    });
}

/** Copies things into a folder: a drop from outside the app, or a paste. */
const copyInto = placeRoute("copy");

/** Moves the Finder's own rows into a folder they were dropped on. */
const moveInto = placeRoute("move");

/**
 * Shows something a Replace moved to the Trash: the item itself when the
 * system said where it landed, else the Trash, which the Finder opens without
 * the app reading it. The Mac only; elsewhere the toast offers nothing.
 */
const showInTrash = base
  .input(z.object({ inTrash: z.string().nullable() }))
  .handler(async ({ input }) => {
    if (input.inTrash !== null) {
      shell.showItemInFolder(input.inTrash);
      return;
    }
    if (process.platform === "darwin") {
      await openPathOnComputer(path.join(os.homedir(), ".Trash"));
    }
  });

/** What a drop or paste into a folder would land on, to ask about before anything is touched. */
const clashes = base
  .input(
    z.object({
      folder: HostPathSchema,
      op: z.enum(["copy", "move"]),
      paths: z.array(HostPathSchema).min(1).max(1000),
    }),
  )
  .output(z.object({ clashes: z.array(ClashSchema) }))
  .handler(async ({ input }) => ({
    clashes: clashesOf(await gatherPlaceRequest(input)),
  }));

/**
 * A clipboard format by the name the system itself gives it, which Electron
 * reaches through a type of its own.
 */
const osClipboardFormat = (name: string) =>
  `electron application/osclipboard;format="${name}"`;

/** The Mac's list of paths: every file manager pastes one file for each. */
const MAC_FILENAMES = osClipboardFormat("NSFilenamesPboardType");

/** What GNOME's Files and the file managers following it paste from. */
const GNOME_COPIED_FILES = osClipboardFormat("x-special/gnome-copied-files");

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Things on this computer, to the clipboard as the files themselves, the way
 * the file manager's Copy puts them there: its Paste copies them, and so
 * does the Finder's here, which reads them back in the window's own paste.
 */
const copyToClipboard = base
  .input(z.object({ paths: z.array(HostPathSchema).min(1).max(1000) }))
  .handler(async ({ input }) => {
    const uris = input.paths.map((at) => pathToFileURL(at).href);
    // On the Mac the list of paths alone: the system turns it into a file
    // URL apiece, which is what the Finder and every other app read, and a
    // URI list beside it would be turned into a second set.
    const formats: Record<string, string> =
      process.platform === "darwin"
        ? {
            [MAC_FILENAMES]: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array>${input.paths
              .map((at) => `<string>${escapeXml(at)}</string>`)
              .join("")}</array></plist>`,
          }
        : { "text/uri-list": uris.join("\r\n") };
    if (process.platform === "linux") {
      formats[GNOME_COPIED_FILES] = ["copy", ...uris].join("\n");
    }
    // Their names as text too, one to a line, as the Finder's Copy leaves
    // them for a text field to paste. A paste in the Finder reads the files.
    formats["text/plain"] = input.paths
      .map((at) => path.basename(at))
      .join("\n");
    await clipboard.write([new ClipboardItem(formats)]);
  });

/**
 * The files on the clipboard, every one of them, for a paste. The Mac's are
 * read through the bridge, since the Finder's Copy puts each on an item of
 * its own and Electron reads only the first; elsewhere this has none to give,
 * and the page reads the paste's own files instead.
 */
const clipboardFiles = base
  .output(
    z.object({
      files: z.array(z.object({ isFolder: z.boolean(), path: z.string() })),
    }),
  )
  .handler(async () => {
    const paths = (await pasteboardFiles()) ?? [];
    const files = await Promise.all(
      paths.map(async (at) => ({
        isFolder: await fs.stat(at).then(
          (stats) => stats.isDirectory(),
          () => false,
        ),
        path: at,
      })),
    );
    return { files };
  });

/** Whether the clipboard holds files a paste would copy in, for the menu's Paste. */
const clipboardHasFiles = base
  .output(z.object({ hasFiles: z.boolean() }))
  .handler(async () => {
    const paths = await pasteboardFiles();
    if (paths !== undefined) {
      return { hasFiles: paths.length > 0 };
    }
    const [item] = await clipboard.read();
    if (!item?.types.includes("text/uri-list")) {
      return { hasFiles: false };
    }
    const uris = await (await item.getType("text/uri-list")).text();
    return {
      hasFiles: uris.split(/\r?\n/).some((uri) => uri.startsWith("file:")),
    };
  });

/**
 * Edit > Paste in the window that asked, for a menu's Paste: whatever holds
 * the keyboard there gets the paste the keys would have given it.
 */
const paste = base.handler(({ context }) => {
  webContents.fromId(context.webContentsId)?.paste();
});

/**
 * Puts a file an editor was given (a picture, a PDF) into the folder of the
 * file it is editing, so the file can name it by a relative path: a file
 * already in that folder or below it is answered as it is, one from anywhere
 * else is copied in, and bytes with no file behind them (a pasted screenshot)
 * are written. A name already taken is numbered beside it, as a second paste
 * of a screenshot is.
 */
const addFile = base
  .errors({
    CANNOT_WRITE: { message: "That folder cannot be written to" },
    ...PROTECTION_ERRORS,
  })
  .input(
    z.union([
      z.object({ folder: HostPathSchema, from: HostPathSchema }),
      z.object({
        /** The bytes, base64. */
        content: z.string(),
        folder: HostPathSchema,
        name: z.string().refine(isUsableName),
      }),
    ]),
  )
  .output(z.object({ path: z.string() }))
  .handler(async ({ errors, input }) => {
    const folder = path.resolve(input.folder);
    if ("from" in input) {
      const inside = path.relative(folder, input.from);
      if (!inside.startsWith("..") && !path.isAbsolute(inside)) {
        return { path: input.from };
      }
    }
    const name = "from" in input ? path.basename(input.from) : input.name;
    const extension = path.extname(name);
    const stem = path.basename(name, extension);
    const added = await writeOrBlock(folder, async () => {
      const made = await freePath(
        folder,
        (n) => (n === 1 ? stem : `${stem} ${n.toString()}`),
        extension,
      );
      await ("from" in input
        ? fs.copyFile(input.from, made, fs.constants.COPYFILE_EXCL)
        : fs.writeFile(made, Buffer.from(input.content, "base64"), {
            flag: "wx",
          }));
      return made;
    });
    if (!added.ok) {
      if ("blocked" in added) {
        throw errors.WINDOWS_PROTECTION({ data: added.blocked });
      }
      throw errors.CANNOT_WRITE({
        message: added.error instanceof Error ? added.error.message : undefined,
      });
    }
    return { path: added.value };
  });

/** Which of `paths` name nothing on this computer, for an editor to mark the links to them. */
const missing = base
  .input(z.object({ paths: z.array(HostPathSchema).max(1000) }))
  .output(z.object({ missing: z.array(z.string()) }))
  .handler(async ({ input }) => {
    const there = await Promise.all(input.paths.map((at) => exists(at)));
    return { missing: input.paths.filter((_, index) => !there[index]) };
  });

const trash = base
  .errors({
    CANNOT_TRASH: { message: "That could not be moved to the trash" },
    ...PROTECTED_ERRORS,
  })
  .input(z.object({ path: HostPathSchema }))
  .output(
    z.object({
      /** The journal entry that takes it back, when there is one. */
      journalId: z.string().nullable(),
    }),
  )
  .handler(async ({ errors, input }) => {
    const kept = await keptInPlace(input.path);
    if (kept) {
      throw errors.PROTECTED({ message: kept });
    }
    const identity = await identityOf(input.path);
    try {
      await shell.trashItem(input.path);
    } catch (error) {
      throw errors.CANNOT_TRASH({
        message: error instanceof Error ? error.message : undefined,
      });
    }
    // Where it landed is found by its identity now, while it is still the
    // newest thing there.
    if (!identity) {
      return { journalId: null };
    }
    const trashed = await findInTrash(identity, { from: input.path });
    const entry = fileJournal.record({
      from: input.path,
      identity,
      kind: "trash",
      trashed,
    });
    // One that was not found is still journaled, so undoing from the keyboard
    // says once where to look rather than quietly taking back something
    // older, but there is no Undo to offer for it.
    return { journalId: trashed === null ? null : entry.id };
  });

/**
 * What the app keeps by path, carried along with a rename or its undo: the
 * recents, and the folders pinned to the sidebar.
 */
function followMove(from: string, to: string) {
  getHistoryStore().moveFiles(from, to);
  const preferences = getMachinePreferences();
  preferences.set(
    "sidebarPlaces",
    moveSidebarPlaces(preferences.get("sidebarPlaces"), from, to, path.sep),
  );
}

/** Writes an action to the journal, by the identity of what it left at `at`. */
async function record(
  at: string,
  entry: (identity: Identity) => NewJournalEntry,
) {
  const identity = await identityOf(at);
  if (identity) {
    fileJournal.record(entry(identity));
  }
}

/**
 * Takes back the newest action in the journal: a rename, a duplicate, a
 * copy, a move, a new folder, or a move to the Trash. One that cannot be taken back safely is
 * refused with the reason. While the person can still clear the way
 * (something has taken its name, a new folder has been filled) it stays in
 * the journal, so nothing older is undone out of order behind it; one that
 * can never be taken back is dropped once it has said why, so the next undo
 * reaches the action before it. A move to the Trash already put back by hand
 * is dropped quietly, and the action before it is taken back instead.
 *
 * `journalId` takes back that one entry instead, as the Undo on the toast an
 * action raised does: it is about those items whatever was done since, and
 * the same checks keep it from touching anything that has changed.
 */
const undo = base
  .errors({
    CANNOT_UNDO: { message: "That cannot be undone" },
    NOTHING_TO_UNDO: { message: "There is nothing to undo" },
  })
  .input(z.object({ journalId: z.string().optional() }).optional())
  .output(
    z.object({
      kind: z.enum([
        "copy",
        "duplicate",
        "move",
        "new-folder",
        "rename",
        "trash",
      ]),
      /** Whether what was put back is a folder. */
      isFolder: z.boolean(),
      /** The entry taken back, so whatever offered to undo it can go. */
      journalId: z.string(),
      /** Where the thing is now, for whatever was put back rather than removed. */
      path: z.string().nullable(),
    }),
  )
  .handler(async ({ errors, input }) => {
    // Each pass drops an entry, so this ends when the journal does.
    for (;;) {
      const entry =
        input?.journalId === undefined
          ? fileJournal.latest()
          : fileJournal.byId(input.journalId);
      if (!entry) {
        throw errors.NOTHING_TO_UNDO();
      }
      try {
        const undone = await undoEntry(entry, {
          leftovers: placingLeftovers,
          trash: (at) => shell.trashItem(at),
        });
        fileJournal.remove(entry.id);
        if (undone.already && input?.journalId === undefined) {
          continue;
        }
        if (entry.kind === "rename") {
          followMove(entry.to, entry.from);
        } else if (entry.kind === "move") {
          for (const moved of entry.moved) {
            followMove(moved.to, moved.from);
          }
        }
        const isFolder =
          undone.path !== null &&
          (await fs.lstat(undone.path).then(
            (stats) => stats.isDirectory(),
            () => false,
          ));
        return {
          isFolder,
          journalId: entry.id,
          kind: entry.kind,
          path: undone.path,
        };
      } catch (error) {
        // A refusal is the undo's answer (the file changed since, say); any
        // other failure is a fault worth seeing, though the person is told
        // the same thing either way.
        if (!(error instanceof UndoRefusedError)) {
          captureServerException(error);
        } else if (error.permanent) {
          fileJournal.remove(entry.id);
        }
        throw errors.CANNOT_UNDO({
          message:
            error instanceof UndoRefusedError ? error.message : undefined,
        });
      }
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
 * comes back, so the editor can merge it and try again. The app's own data is
 * not written (`isClosed`).
 */
const write = base
  .errors({
    CANNOT_WRITE: { message: "That file cannot be written to" },
    FORBIDDEN: { message: "That file is Instrument’s own data" },
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
    const filePath = await followAliases(input.path);
    if (await isClosed(input.path, filePath)) {
      throw errors.FORBIDDEN();
    }
    try {
      return await oneWriterAt(filePath, async () => {
        // A write with no version to check creates the file when it is not
        // there; one with a version needs the file it edited.
        const bytes =
          input.baseVersion === undefined
            ? await fs.readFile(filePath).catch(() => null)
            : await fs.readFile(filePath);
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
        await writeWhole(filePath, input.content);
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
 * `utf8` false so the editor opens it read only: `write` refuses it. The
 * app's own data is not read (`isClosed`).
 */
const read = base
  .errors({ FORBIDDEN: { message: "That file is Instrument’s own data" } })
  .input(z.object({ path: HostPathSchema }))
  .output(
    z.object({ content: z.string(), utf8: z.boolean(), version: z.string() }),
  )
  .handler(async ({ errors, input }) => {
    const filePath = await followAliases(input.path);
    if (await isClosed(input.path, filePath)) {
      throw errors.FORBIDDEN();
    }
    const bytes = await fs.readFile(filePath);
    const strict = utf8Text(bytes);
    const content = strict ?? bytes.toString("utf8");
    return { content, utf8: strict !== null, version: versionOf(content) };
  });

/**
 * Whether a file is the app's own data, which the person's views keep closed:
 * the editors read and write through here what the viewers read through the
 * file channel, which refuses it by the same rule (`refused-files.ts`), by
 * the path asked for and by where its aliases lead.
 */
async function isClosed(asked: string, filePath: string): Promise<boolean> {
  return isRefusedByName(asked) || (await isRefusedFile(filePath));
}

/**
 * A text file's path with every Finder alias on it followed, so an editor
 * opened on an alias reads and writes the file it leads to, the way the
 * computer-file channel serves it.
 */
function followAliases(hostPath: string): Promise<string> {
  return resolveThroughAliases(hostPath, resolveAlias);
}

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
        path: await followAliases(input.path),
        signal,
      });
    }),
};

/**
 * Lets the programs Windows' ransomware protection blocked, and the app
 * itself, through it, behind Windows' own prompt for an administrator's yes.
 */
const allowThroughProtection = base
  .input(z.object({ programs: z.array(z.string()) }))
  .output(z.object({ outcome: z.enum(["allowed", "canceled", "failed"]) }))
  .handler(async ({ input }) => ({
    outcome:
      process.platform === "win32"
        ? await allowProgramsThroughProtection([
            ...new Set([...input.programs, process.execPath]),
          ])
        : "failed",
  }));

export const files = {
  addFile,
  allowThroughProtection,
  clashes,
  clipboardFiles,
  clipboardHasFiles,
  copyInto,
  copyToClipboard,
  duplicate,
  live,
  missing,
  moveInto,
  newFolder,
  paste,
  read,
  rename,
  showInTrash,
  trash,
  undo,
  write,
};
