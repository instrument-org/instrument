import { DRAFTS_KEY } from "@/shared/kept-state";
import {
  type DraftAttached,
  type DraftFile,
  type DraftOnDisk,
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

import { logger } from "../../lib/electron-logger";

/** How long a burst of changes on disk is gathered before the folder is read again. */
const WATCH_SETTLE_MS = 150;

/** A draft id, as the window makes one. */
const DRAFT_ID = /^[\w-]+$/;

/** A draft as the window keeps it: any object with an id and words. */
type DraftRecord = Record<string, unknown> & { id: string; words: string };

/**
 * The window's drafts as the folder a person opens holds them:
 * `Drafts/<date>/DRAFT.md` per draft, with what was pasted into it beside the
 * draft. A draft can be found, read, edited and deleted in a file manager,
 * and a change made there reaches the windows.
 *
 * Holds the one kept key {@link DRAFTS_KEY} for the kept-state store. The
 * format and the folder are the workspace's
 * (`@instrument-org/workspace/drafts`), because a launch reads and writes
 * them before the workspace is up; what is here is the translation between a
 * draft on disk and the record a window keeps.
 *
 * Remembers what it last wrote or read for each draft, so a keystroke
 * rewrites only the draft it changed, and a change on disk is told apart from
 * its own writes.
 */
export function createDraftsFolder(rootDir: string) {
  /** By draft id: the bytes last written or read for it, and where they are. */
  const known = new Map<string, { file: string; text: string }>();

  const remember = (found: DraftOnDisk[]) => {
    known.clear();
    for (const entry of found) {
      known.set(entry.draft.id, {
        file: entry.file,
        text: renderDraftFile(entry.draft),
      });
    }
  };

  const recordsOf = (found: DraftOnDisk[]): DraftRecord[] =>
    found.map((entry) => recordOf(entry));

  return {
    /** Every draft in the folder, oldest first, as the kept key's value. */
    read(): Record<string, unknown> {
      const disk = readDrafts(rootDir);
      remember(disk);
      return { [DRAFTS_KEY]: recordsOf(disk) };
    },

    /**
     * Brings what the window kept and what is on disk together after the
     * folder changed under the app: a draft whose file changed is taken from
     * disk, one whose file went is dropped, and the rest are left as the
     * window has them. Undefined when nothing changed but the app's own
     * writes.
     */
    reconcile(current: Record<string, unknown>) {
      const disk = readDrafts(rootDir);
      const changed = new Set(
        disk
          .filter(
            (entry) =>
              known.get(entry.draft.id)?.text !== renderDraftFile(entry.draft),
          )
          .map((entry) => entry.draft.id),
      );
      const onDisk = new Set(disk.map((entry) => entry.draft.id));
      const removed = [...known.keys()].filter((id) => !onDisk.has(id));
      if (changed.size === 0 && removed.length === 0) {
        return undefined;
      }
      remember(disk);
      const fromDisk = new Map(
        recordsOf(disk).map((draft) => [draft.id, draft]),
      );
      const kept = draftsOf(current[DRAFTS_KEY]).flatMap((draft) => {
        const found = fromDisk.get(draft.id);
        if (found === undefined) {
          return [];
        }
        return [changed.has(draft.id) ? found : draft];
      });
      const keptIds = new Set(kept.map((draft) => draft.id));
      const added = [...fromDisk.values()].filter(
        (draft) => !keptIds.has(draft.id),
      );
      return { [DRAFTS_KEY]: [...kept, ...added] };
    },

    /**
     * Writes the drafts the window keeps: each one's file where it changed,
     * and every draft it no longer has taken away, with what was pasted into
     * it. A draft the folder has no file for yet gets one, in a folder named
     * for the day it was started, once there is something in it to keep: a
     * box opened and left alone leaves nothing behind.
     */
    write(keys: Record<string, unknown>) {
      const value = keys[DRAFTS_KEY];
      if (!Array.isArray(value)) {
        return;
      }
      const drafts = draftsOf(value);
      const ids = new Set(drafts.map((draft) => draft.id));
      // Read once: this runs every few hundred milliseconds while somebody
      // is typing, and a read per draft would be a listing per draft.
      const onDisk = new Map(
        readDrafts(rootDir).map((entry) => [entry.draft.id, entry]),
      );
      for (const [id, entry] of onDisk) {
        if (!ids.has(id)) {
          removeDraft(entry);
          known.delete(id);
          onDisk.delete(id);
        }
      }
      for (const record of drafts) {
        try {
          const found = onDisk.get(record.id);
          if (found === undefined && isEmptyDraft(fileOf(record, undefined))) {
            continue;
          }
          const where =
            found ??
            ensureDraftFolder({
              draft: fileOf(record, undefined),
              rootDir,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          const draft = fileOf(record, where.dir);
          const text = renderDraftFile(draft);
          if (known.get(record.id)?.text !== text) {
            writeDraftFile(where.file, draft);
          }
          known.set(record.id, { file: where.file, text });
        } catch (error) {
          logger.error(`Could not write draft ${record.id}`, error);
        }
      }
    },

    /**
     * Calls back when the drafts folder changes, its contents or a draft's
     * file, gathered over a beat. The app's own writes call back too;
     * `reconcile` is what tells them apart. A workspace with no drafts has
     * no folder, so the watch starts when the first draft makes it.
     */
    watch(onChange: () => void): () => void {
      const root = draftsFolderDir(rootDir);
      let watcher: fs.FSWatcher | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, WATCH_SETTLE_MS);
      };
      const start = () => {
        try {
          watcher = fs.watch(root, { recursive: true }, changed);
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
          changed();
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
 * The folder a draft's files go in, made if it is not there: where something
 * pasted into a draft is written, which happens before the draft itself has
 * been saved.
 */
export function draftDirOf(rootDir: string, draftId: string): string {
  const now = new Date();
  return ensureDraftFolder({
    draft: { created: now, id: draftId, updated: now, words: "" },
    rootDir,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).dir;
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

/**
 * The draft the window has, as the file holds one: the keys the file names,
 * and the rest of the record under `state`. A path inside the draft's own
 * folder is kept relative to it, so the folder travels; `dir` is that folder,
 * which is unknown the first time a draft is written and does not matter
 * then, because the folder it names is the one about to be made.
 */
function fileOf(record: DraftRecord, dir: string | undefined): DraftFile {
  const {
    attached,
    chatId,
    createdAt,
    id,
    send,
    sendOn,
    topicId,
    updatedAt,
    words,
    ...state
  } = record;
  const created =
    typeof createdAt === "number" ? new Date(createdAt) : new Date();
  const items = attachedOf(attached, dir);
  return {
    ...(items ? { attached: items } : {}),
    ...(typeof chatId === "string" && chatId ? { chat: chatId } : {}),
    created,
    id,
    ...(send === "auto" ? { send: "auto" as const } : {}),
    ...(typeof sendOn === "string" && sendOn ? { sendOn } : {}),
    ...(Object.keys(state).length > 0 ? { state } : {}),
    ...(typeof topicId === "string" && topicId ? { topic: topicId } : {}),
    updated: typeof updatedAt === "number" ? new Date(updatedAt) : created,
    words,
  };
}

/**
 * A draft as the window keeps it: what the file holds, with every path it
 * names absolute, since the window shows and sends files by path, and the
 * keys the window's own record uses.
 */
function recordOf({ dir, draft }: DraftOnDisk): DraftRecord {
  const attached = (draft.attached ?? []).map((item) => ({
    kind: item.kind,
    ...(item.mediaType === undefined ? {} : { mimeType: item.mediaType }),
    ...(item.name === undefined ? {} : { name: item.name }),
    path: path.isAbsolute(item.path) ? item.path : path.join(dir, item.path),
    ...(item.size === undefined ? {} : { size: item.size }),
  }));
  return {
    ...draft.state,
    ...(attached.length > 0 ? { attached } : {}),
    ...(draft.chat === undefined ? {} : { chatId: draft.chat }),
    createdAt: draft.created.getTime(),
    id: draft.id,
    ...(draft.send === undefined ? {} : { send: draft.send }),
    ...(draft.sendOn === undefined ? {} : { sendOn: draft.sendOn }),
    ...(draft.topic === undefined ? {} : { topicId: draft.topic }),
    updatedAt: draft.updated.getTime(),
    words: draft.words,
  };
}

function attachedOf(
  value: unknown,
  dir: string | undefined,
): DraftAttached[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.flatMap((entry: unknown) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !("path" in entry) ||
      typeof entry.path !== "string"
    ) {
      return [];
    }
    const kind = "kind" in entry && entry.kind === "folder" ? "folder" : "file";
    const name = "name" in entry ? entry.name : undefined;
    const mimeType = "mimeType" in entry ? entry.mimeType : undefined;
    const size = "size" in entry ? entry.size : undefined;
    return [
      {
        kind: kind as DraftAttached["kind"],
        ...(typeof mimeType === "string" ? { mediaType: mimeType } : {}),
        ...(typeof name === "string" ? { name } : {}),
        path:
          dir !== undefined && path.dirname(entry.path) === dir
            ? path.basename(entry.path)
            : entry.path,
        ...(typeof size === "number" ? { size } : {}),
      },
    ];
  });
  return items.length > 0 ? items : undefined;
}

/** Every draft in a kept value that names itself: an id the window made, and words. */
function draftsOf(value: unknown): DraftRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !DRAFT_ID.test(entry.id)
    ) {
      return [];
    }
    const words =
      "words" in entry && typeof entry.words === "string" ? entry.words : "";
    return [
      { ...Object.fromEntries(Object.entries(entry)), id: entry.id, words },
    ];
  });
}
