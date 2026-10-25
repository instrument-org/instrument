import {
  applyDraftOps,
  type Draft,
  type DraftOpBatch,
  type DraftsSnapshot,
  type DraftStageRequest,
  type DraftTrashRequest,
} from "@/shared/drafts";
import {
  DRAFT_FILE_NAME,
  type DraftFile,
  type DraftOnDisk,
  draftsFolderDir,
  ensureDraftFolder,
  isDraftFolderItem,
  isEmptyDraft,
  parseDraftFile,
  readDrafts,
  removeDraft,
  renderDraftFile,
  writeDraftFile,
} from "@instrument-org/workspace/drafts";
import { watchFolder } from "@instrument-org/workspace/electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { logger } from "../lib/electron-logger";
import { draftFileOf, draftOf, withFolderOf } from "./draft-record";

/** An id a window made, which one draft or one pasted item is known by. */
const IdSchema = z.string().regex(/^[\w-]+$/);

/** Bytes pasted into a draft, named by a file's own name and never a path. */
const StageRequestSchema = z.object({
  content: z.string(),
  draftId: IdSchema,
  itemId: IdSchema,
  name: z
    .string()
    .min(1)
    .refine(
      (name) => name === path.basename(name) && name !== "." && name !== "..",
    ),
}) satisfies z.ZodType<DraftStageRequest>;

/** A file or folder in one draft's folder, to move to the Trash. */
const TrashRequestSchema = z.object({
  draftId: IdSchema,
  path: z.string().min(1),
}) satisfies z.ZodType<DraftTrashRequest>;

/** Where a draft's file is, and what this store last wrote there or read from it. */
interface OnDisk {
  dir: string;
  file: string;
  /** What the draft's folder had beside the file when last read, as {@link folderKeyOf} writes it. */
  folder: string;
  /** The file as {@link textOf} renders it, which is how a change made elsewhere is told from this store's own. */
  text: string;
}

/**
 * The workspace's drafts, owned by the main process: `Drafts/<date>/DRAFT.md`
 * per draft (the format and folder are `@instrument-org/workspace/drafts`).
 *
 * The one writer of that folder while the app runs. A window changes a draft
 * by sending ops, which this applies, writes through at once, and answers by
 * telling every window what the drafts are now. A change made in the folder
 * by anything else (a file manager, a sync engine bringing another device's
 * edit) is read back in and told the same way, and so is a file put into a
 * draft's folder or taken out of it, since the folder is what goes with the
 * message.
 *
 * Each draft's file is written only when what it says changed, and a file is
 * made for a draft only once there is something in it, so a box opened and
 * left alone leaves nothing behind.
 *
 * What it remembers of each file is what tells a change made elsewhere from
 * its own: a file reading as it was last written is this store's, and
 * anything else came from outside. A draft it was told was sent stays gone
 * for as long as it runs, so a copy a sync engine brings back is taken away
 * rather than offered to be sent again.
 */
export function createDraftStore({
  onChange,
  rootDir,
  timeZone,
  moveToTrash,
}: {
  /** Called with the drafts each time they change, from a window or from disk. */
  onChange: (snapshot: DraftsSnapshot) => void;
  /** The workspace's own folder, which `Drafts/` is at the top of. */
  rootDir: string;
  /** The zone a new draft's folder is named in: this computer's own. */
  timeZone: string;
  /**
   * Moves a file or folder to the system's Trash: how something the person
   * may have only the one copy of leaves a draft's folder.
   */
  moveToTrash: (target: string) => Promise<void>;
}) {
  let drafts: Draft[] = [];
  const onDisk = new Map<string, OnDisk>();
  const sent = new Set<string>();
  /**
   * The drafts a window here has on its way, by id: a file read while one is
   * in flight does not take it off its way, since the file is only as far
   * along as the store's last write.
   */
  const sending = new Set<string>();
  const acks: Record<string, number> = {};
  /** By draft and pasted item: where its bytes were written, so a second stage of one item writes over the first. */
  const staged = new Map<string, string>();

  const snapshot = (): DraftsSnapshot => ({ acks: { ...acks }, drafts });

  /**
   * Of the files holding one draft, the one that is the draft: the one this
   * store has been writing, else the one named as a draft is named, else the
   * oldest. The others are a sync engine's conflict copies, left for the
   * person to look at.
   */
  const pick = (id: string, entries: DraftOnDisk[]): DraftOnDisk => {
    const known = onDisk.get(id)?.file;
    return (
      entries.find((entry) => entry.file === known) ??
      entries.find((entry) => path.basename(entry.file) === DRAFT_FILE_NAME) ??
      entries[0] ??
      unreachable(id)
    );
  };

  /**
   * A draft taken in from its file and its folder, still on its way where a
   * window here has it on its way. Where only the folder changed, the draft
   * is the one this store has, with what the folder has now.
   */
  const takeIn = (entry: DraftOnDisk, read = draftOf(entry, rootDir)) => {
    const id = entry.draft.id;
    const text = textOf(entry.draft);
    const known = onDisk.get(id);
    onDisk.set(id, {
      dir: entry.dir,
      file: entry.file,
      folder: folderKeyOf(read),
      text,
    });
    const current = drafts.find((draft) => draft.id === id);
    if (current === undefined) {
      drafts = [...drafts, read];
      return;
    }
    const taken =
      known?.file === entry.file && known.text === text
        ? withFolderOf(current, read, entry.dir)
        : read;
    const next =
      sending.has(id) && current.sendingTo !== undefined
        ? { ...taken, sendingTo: current.sendingTo }
        : taken;
    drafts = drafts.map((draft) => (draft.id === id ? next : draft));
  };

  /**
   * Whatever the files of these drafts say that this store has not read
   * yet, taken in before ops change them: an edit made elsewhere that the
   * watcher has not brought in would otherwise be written over by the next
   * change, and then read back as the store's own.
   */
  const refresh = (ids: Iterable<string>) => {
    for (const id of ids) {
      const known = onDisk.get(id);
      if (known === undefined) {
        continue;
      }
      const found = readFile(known.file);
      if (found !== undefined && textOf(found) !== known.text) {
        takeIn({ dir: known.dir, draft: found, file: known.file });
      }
    }
  };

  /** Writes what changed between `before` and `drafts`, and takes away what went. */
  const persist = (before: Draft[]) => {
    const now = new Map(drafts.map((draft) => [draft.id, draft]));
    for (const draft of before) {
      if (!now.has(draft.id)) {
        forget(draft.id);
      }
    }
    const was = new Map(before.map((draft) => [draft.id, draft]));
    for (const draft of drafts) {
      if (was.get(draft.id) !== draft) {
        write(draft, { force: false });
      }
    }
  };

  /** A draft's file brought up to date, made where there is something to keep or `force` asks for one. */
  const write = (draft: Draft, { force }: { force: boolean }) => {
    try {
      if (!onDisk.has(draft.id)) {
        const file = draftFileOf(draft, { dir: undefined, rootDir });
        if (!force && isEmptyDraft(file)) {
          return undefined;
        }
        const made = ensureDraftFolder({ draft: file, rootDir, timeZone });
        onDisk.set(draft.id, {
          dir: made.dir,
          file: made.file,
          folder: folderKeyOf({}),
          text: textOf(file),
        });
      }
      return save(draft);
    } catch (error) {
      logger.error(`Could not write draft ${draft.id}`, error);
      return undefined;
    }
  };

  const save = (draft: Draft) => {
    const known = onDisk.get(draft.id);
    if (known === undefined) {
      return undefined;
    }
    const file = draftFileOf(draft, { dir: known.dir, rootDir });
    const text = textOf(file);
    if (known.text !== text) {
      writeDraftFile(known.file, file);
    }
    const kept = { ...known, text };
    onDisk.set(draft.id, kept);
    return kept;
  };

  /**
   * A draft taken away: every file holding it, conflict copies too, and its
   * folder once that leaves it empty. What a sent draft's folder had went to
   * the chat; what a thrown-away one's had goes to the Trash, since it may be
   * the only copy of something the person put there.
   */
  const forget = (id: string) => {
    onDisk.delete(id);
    sending.delete(id);
    for (const key of staged.keys()) {
      if (key.startsWith(`${id}/`)) {
        staged.delete(key);
      }
    }
    try {
      const entries = readDrafts(rootDir).filter(
        (entry) => entry.draft.id === id,
      );
      for (const entry of entries) {
        const left = removeDraft(entry, { sent: sent.has(id) });
        if (left.length > 0) {
          void throwAway(entry.dir, left);
        }
      }
    } catch (error) {
      logger.error(`Could not take away draft ${id}`, error);
    }
  };

  /** What a thrown-away draft's folder had, to the Trash, and the folder after it. */
  const throwAway = async (dir: string, items: { path: string }[]) => {
    for (const item of items) {
      await moveToTrash(item.path).catch((error: unknown) => {
        logger.error(`Could not move ${item.path} to the Trash`, error);
      });
    }
    removeIfEmpty(dir);
  };

  return {
    /**
     * Applies a window's ops, writes them through, and tells every window.
     * Synchronous, so by the time a window hears back the files say what the
     * ops did: a send marks its draft on its way before it writes anything in
     * the chat.
     */
    apply(batch: DraftOpBatch) {
      refresh(
        batch.ops.map((op) => (op.type === "create" ? op.draft.id : op.id)),
      );
      const before = drafts;
      drafts = applyDraftOps(drafts, batch.ops);
      for (const op of batch.ops) {
        switch (op.type) {
          case "claim": {
            sending.add(op.id);
            break;
          }
          case "sent": {
            sent.add(op.id);
            sending.delete(op.id);
            break;
          }
          case "release":
          case "remove": {
            sending.delete(op.id);
            break;
          }
          case "create":
          case "update": {
            break;
          }
        }
      }
      persist(before);
      acks[batch.client] = Math.max(acks[batch.client] ?? 0, batch.seq);
      onChange(snapshot());
    },

    /** Every draft in the folder, read once as the store opens. */
    load() {
      drafts = [];
      onDisk.clear();
      for (const [id, entries] of byDraft(readDrafts(rootDir))) {
        takeIn(pick(id, entries));
      }
    },

    /**
     * Takes in what changed in the folder since this store last wrote or read
     * it: a draft whose file reads differently is taken from the file, one
     * whose file went is gone, and a file for a draft this store has not seen
     * is a draft of its own. A file still there that cannot be read for the
     * moment (an editor partway through a save, a placeholder a sync engine
     * has yet to fill) leaves its draft as it was.
     */
    reconcile() {
      const before = drafts;
      const found = byDraft(readDrafts(rootDir));
      for (const [id, entries] of found) {
        if (sent.has(id)) {
          for (const entry of entries) {
            try {
              removeDraft(entry, { sent: true });
            } catch (error) {
              logger.error(`Could not take away sent draft ${id}`, error);
            }
          }
          continue;
        }
        const known = onDisk.get(id);
        if (
          known !== undefined &&
          !entries.some((entry) => entry.file === known.file) &&
          fs.existsSync(known.file)
        ) {
          continue;
        }
        const entry = pick(id, entries);
        const read = draftOf(entry, rootDir);
        if (
          known?.file === entry.file &&
          known.text === textOf(entry.draft) &&
          known.folder === folderKeyOf(read)
        ) {
          continue;
        }
        takeIn(entry, read);
      }
      for (const [id, known] of onDisk) {
        if (!found.has(id) && !fs.existsSync(known.file)) {
          onDisk.delete(id);
          sending.delete(id);
          drafts = drafts.filter((draft) => draft.id !== id);
        }
      }
      if (drafts !== before) {
        onChange(snapshot());
      }
    },

    snapshot,

    /**
     * Writes bytes pasted into a draft with no file behind them into the
     * draft's own folder, under their own name, so the draft keeps them past
     * a relaunch as a path. The folder is made for it if the draft has none
     * yet, since a paste can arrive before any words have.
     */
    stage(asked: unknown): { path: string; size: number } {
      const request = StageRequestSchema.parse(asked);
      const draft = drafts.find((entry) => entry.id === request.draftId);
      if (draft === undefined) {
        throw new Error(`No draft ${request.draftId} to paste into`);
      }
      const where = write(draft, { force: true });
      if (where === undefined) {
        throw new Error(`Could not make a folder for draft ${draft.id}`);
      }
      const item = `${draft.id}/${request.itemId}`;
      // The one already written, where it is still in the folder the draft is
      // in now: a draft's folder can be taken away and made again.
      const was = staged.get(item);
      const file =
        was !== undefined && path.dirname(was) === where.dir
          ? was
          : path.join(where.dir, freeNameIn(where.dir, request.name));
      staged.set(item, file);
      const bytes = Buffer.from(request.content, "base64");
      fs.writeFileSync(file, bytes);
      return { path: file, size: bytes.byteLength };
    },

    /**
     * Moves a file or folder in a draft's folder to the Trash, for a chip the
     * person took off: it may be their only copy of something they dragged
     * in. Anything else, a file the draft names where it lies above all, is
     * left alone. The folder's watch brings the change back in.
     */
    async trash(asked: unknown): Promise<void> {
      const request = TrashRequestSchema.parse(asked);
      const known = onDisk.get(request.draftId);
      if (known === undefined || !isDraftFolderItem(known.dir, request.path)) {
        return;
      }
      await moveToTrash(request.path);
    },

    /**
     * Calls back when what the drafts folder holds changes. This store's own
     * writes call back too; {@link reconcile} is what tells them apart. A
     * workspace with no drafts has no folder, and the first draft's making
     * it is a change.
     */
    watch(changed: () => void): () => void {
      return watchFolder(draftsFolderDir(rootDir), {
        depth: 1,
        onChange: changed,
      });
    },
  };
}

/** Drafts on disk by id, each with every file holding it. */
function byDraft(entries: DraftOnDisk[]): Map<string, DraftOnDisk[]> {
  const found = new Map<string, DraftOnDisk[]>();
  for (const entry of entries) {
    found.set(entry.draft.id, [...(found.get(entry.draft.id) ?? []), entry]);
  }
  return found;
}

/** What a draft's folder has beside its file, as one string that changes when that does. */
function folderKeyOf({ inFolder }: Pick<Draft, "inFolder">): string {
  return JSON.stringify(inFolder ?? []);
}

/** A draft's file read on its own, or nothing where it is gone or names no draft. */
function readFile(file: string): DraftFile | undefined {
  try {
    return parseDraftFile(fs.readFileSync(file, "utf8"), {
      at: fs.statSync(file).mtime,
    });
  } catch {
    return undefined;
  }
}

function removeIfEmpty(dir: string) {
  try {
    fs.rmdirSync(dir);
  } catch {
    // Something else is in the folder, which is not the draft's to take.
  }
}

function unreachable(id: string): never {
  throw new Error(`No file holds draft ${id}`);
}

/**
 * A draft's file as this store compares it: rendered without the front
 * matter other programs left, which the folder layer keeps on every write
 * and which is nothing to this build.
 */
function textOf(file: DraftFile): string {
  const { others: _others, ...own } = file;
  return renderDraftFile(own);
}

/**
 * A new name for a file going into a folder, beside the ones already there:
 * the name itself when it is free, otherwise numbered the way Finder numbers
 * a copy (`image 2.png`).
 */
export function freeNameIn(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) {
    return name;
  }
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n.toString()}${extension}`;
    if (!fs.existsSync(path.join(dir, candidate))) {
      return candidate;
    }
  }
}
