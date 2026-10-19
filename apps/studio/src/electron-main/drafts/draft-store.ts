import {
  applyDraftOps,
  type Draft,
  type DraftOpBatch,
  type DraftsSnapshot,
  type DraftStageRequest,
} from "@/shared/drafts";
import {
  type DraftFile,
  draftsFolderDir,
  ensureDraftFolder,
  isEmptyDraft,
  readDrafts,
  removeDraft,
  renderDraftFile,
  writeDraftFile,
} from "@instrument-org/workspace/drafts";
import {
  afterFolderAppears,
  isFolder,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { logger } from "../lib/electron-logger";
import { draftFileOf, draftOf } from "./draft-record";

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

/** How long a burst of changes on disk is gathered before the folder is read again. */
const WATCH_SETTLE_MS = 150;

/** Where a draft's file is, and what this store last wrote there or read from it. */
interface OnDisk {
  dir: string;
  file: string;
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
 * edit) is read back in and told the same way.
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
}: {
  /** Called with the drafts each time they change, from a window or from disk. */
  onChange: (snapshot: DraftsSnapshot) => void;
  /** The workspace's own folder, which `Drafts/` is at the top of. */
  rootDir: string;
  /** The zone a new draft's folder is named in: this computer's own. */
  timeZone: string;
}) {
  let drafts: Draft[] = [];
  const onDisk = new Map<string, OnDisk>();
  const sent = new Set<string>();
  const acks: Record<string, number> = {};
  /** By draft and pasted item: where its bytes were written, so a second stage of one item writes over the first. */
  const staged = new Map<string, string>();

  const snapshot = (): DraftsSnapshot => ({ acks: { ...acks }, drafts });

  /** Writes what changed between `before` and `drafts`, and takes away what went. */
  const persist = (before: Draft[]) => {
    const now = new Map(drafts.map((draft) => [draft.id, draft]));
    for (const draft of before) {
      if (!now.has(draft.id)) {
        forget(draft);
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
    const known = onDisk.get(draft.id);
    try {
      if (known === undefined) {
        const file = draftFileOf(draft, undefined);
        if (!force && isEmptyDraft(file)) {
          return undefined;
        }
        const made = ensureDraftFolder({ draft: file, rootDir, timeZone });
        const where = { dir: made.dir, file: made.file };
        return save(draft, where);
      }
      return save(draft, known);
    } catch (error) {
      logger.error(`Could not write draft ${draft.id}`, error);
      return undefined;
    }
  };

  const save = (draft: Draft, where: { dir: string; file: string }) => {
    const file = draftFileOf(draft, where.dir);
    const text = textOf(file);
    if (onDisk.get(draft.id)?.text !== text) {
      writeDraftFile(where.file, file);
    }
    const kept = { ...where, text };
    onDisk.set(draft.id, kept);
    return kept;
  };

  /** A draft's file taken away, with what was pasted into it. */
  const forget = (draft: Draft) => {
    const known = onDisk.get(draft.id);
    onDisk.delete(draft.id);
    for (const key of staged.keys()) {
      if (key.startsWith(`${draft.id}/`)) {
        staged.delete(key);
      }
    }
    if (known === undefined) {
      return;
    }
    try {
      removeDraft({
        dir: known.dir,
        draft: draftFileOf(draft, known.dir),
        file: known.file,
      });
    } catch (error) {
      logger.error(`Could not take away draft ${draft.id}`, error);
    }
  };

  return {
    /**
     * Applies a window's ops, writes them through, and tells every window.
     * Synchronous, so by the time a window hears back the files say what the
     * ops did: a send points its draft at the chat before it writes anything
     * there.
     */
    apply(batch: DraftOpBatch) {
      const before = drafts;
      drafts = applyDraftOps(drafts, batch.ops);
      for (const op of batch.ops) {
        if (op.type === "sent") {
          sent.add(op.id);
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
      const seen = new Set<string>();
      for (const entry of readDrafts(rootDir)) {
        // Two files holding one draft are a sync engine's conflict copy
        // beside its original: the older is the draft, and the copy is left
        // where it is for the person to look at.
        if (seen.has(entry.draft.id)) {
          continue;
        }
        seen.add(entry.draft.id);
        drafts.push(draftOf(entry));
        onDisk.set(entry.draft.id, {
          dir: entry.dir,
          file: entry.file,
          text: textOf(entry.draft),
        });
      }
    },

    /**
     * Takes in what changed in the folder since this store last wrote or read
     * it: a draft whose file reads differently is taken from the file, one
     * whose file went is gone, and a file for a draft this store has not seen
     * is a draft of its own. A draft on its way into a chat stays on its way.
     */
    reconcile() {
      const before = drafts;
      const seen = new Set<string>();
      for (const entry of readDrafts(rootDir)) {
        const id = entry.draft.id;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        if (sent.has(id)) {
          removeDraft(entry);
          continue;
        }
        const text = textOf(entry.draft);
        const known = onDisk.get(id);
        if (known?.text === text && known.file === entry.file) {
          continue;
        }
        onDisk.set(id, { dir: entry.dir, file: entry.file, text });
        const read = draftOf(entry);
        const current = drafts.find((draft) => draft.id === id);
        drafts =
          current === undefined
            ? [...drafts, read]
            : drafts.map((draft) =>
                draft.id === id ? stillSending(read, current) : draft,
              );
      }
      for (const id of onDisk.keys()) {
        if (!seen.has(id)) {
          onDisk.delete(id);
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
     * Calls back when the drafts folder changes, gathered over a beat. This
     * store's own writes call back too; {@link reconcile} is what tells them
     * apart. A workspace with no drafts has no folder, so the watch starts
     * when the first draft makes it.
     */
    watch(changed: () => void): () => void {
      const root = draftsFolderDir(rootDir);
      let watcher: fs.FSWatcher | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        clearTimeout(timer);
        timer = setTimeout(changed, WATCH_SETTLE_MS);
      };
      const start = () => {
        try {
          watcher = fs.watch(root, { recursive: true }, settle);
          watcher.on("error", (error) => {
            logger.warn(`Stopped watching drafts in ${root}`, error);
            watcher?.close();
          });
        } catch (error) {
          logger.warn(`Could not watch drafts in ${root}`, error);
        }
      };
      let stopWaiting: (() => void) | undefined;
      if (isFolder(root)) {
        start();
      } else {
        stopWaiting = afterFolderAppears(root, () => {
          start();
          // Whatever arrived with the folder came before the watch did.
          settle();
        });
      }
      return () => {
        stopWaiting?.();
        clearTimeout(timer);
        watcher?.close();
      };
    },
  };
}

/**
 * A draft read from its file while it is on its way into a chat: still on
 * its way, and still the kind of draft it was. The file names the chat it is
 * being sent into, which for a new chat's draft is no reply's chat.
 */
function stillSending(read: Draft, current: Draft): Draft {
  if (current.sendingTo === undefined) {
    return read;
  }
  const { chatId: _named, ...rest } = read;
  return {
    ...rest,
    ...(current.chatId === undefined ? {} : { chatId: current.chatId }),
    sendingTo: current.sendingTo,
  };
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
