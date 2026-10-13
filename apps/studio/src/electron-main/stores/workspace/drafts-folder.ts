import { DRAFTS_KEY } from "@/shared/kept-state";
import fs from "node:fs";
import path from "node:path";

import { logger } from "../../lib/electron-logger";

/** The folder at the workspace root holding one folder per draft. */
export const DRAFTS_DIR_NAME = "drafts";

/** What a draft's words are kept in, inside its folder. */
const WORDS_FILE_NAME = "draft.md";

/** How long a burst of changes on disk is gathered before the folder is read again. */
const WATCH_SETTLE_MS = 150;

/** A draft id, used as its folder's name. */
const DRAFT_ID = /^[\w-]+$/;

/** A draft as the window keeps it: any object with an id and words. */
type DraftRecord = Record<string, unknown> & { id: string; words: string };

/** A draft as its folder holds it: its words, and the rest of its record. */
interface DraftFiles {
  record: string;
  words: string;
}

export function draftDirOf(root: string, draftId: string) {
  return path.join(root, draftId);
}

function recordPathOf(dir: string) {
  return path.join(dir, ".instrument", "settings.json");
}

/**
 * The window's drafts as a folder per draft at the workspace root, where the
 * person can find them: the words in `draft.md`, what was pasted in with no
 * file behind it beside them, and the rest of the record in the folder's
 * `.instrument/settings.json`. A path to a file in the draft's own folder is
 * kept relative to it. Deleting the folder deletes the draft.
 *
 * Holds the one kept key {@link DRAFTS_KEY} for the kept-state store. Remembers
 * what it last wrote or read for each draft, so a keystroke rewrites only the
 * draft it changed, and a change on disk is told apart from its own writes.
 */
export function createDraftsFolder(root: string) {
  const known = new Map<string, DraftFiles>();

  const readDisk = (): Map<string, DraftFiles> => {
    const found = new Map<string, DraftFiles>();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !DRAFT_ID.test(entry.name)) {
        continue;
      }
      const dir = draftDirOf(root, entry.name);
      let record: string;
      try {
        record = fs.readFileSync(recordPathOf(dir), "utf8");
      } catch {
        // A folder with no record is not a draft (yet): one being made, or
        // something else the person put here.
        continue;
      }
      let words = "";
      try {
        words = fs.readFileSync(path.join(dir, WORDS_FILE_NAME), "utf8");
      } catch {
        // Words gone from the folder are a draft with no words.
      }
      found.set(entry.name, { record, words });
    }
    return found;
  };

  const draftOf = (id: string, files: DraftFiles): DraftRecord | undefined => {
    let record: unknown;
    try {
      record = JSON.parse(files.record);
    } catch {
      logger.warn(`Ignoring draft ${id}: its settings are not JSON`);
      return undefined;
    }
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      return undefined;
    }
    return {
      ...withPaths(record, (file) =>
        path.isAbsolute(file) ? file : path.join(draftDirOf(root, id), file),
      ),
      id,
      words: files.words,
    };
  };

  const filesOf = (draft: DraftRecord): DraftFiles => {
    const { id, words, ...rest } = draft;
    const dir = draftDirOf(root, id);
    const record = withPaths(rest, (file) =>
      path.dirname(file) === dir ? path.basename(file) : file,
    );
    return { record: `${JSON.stringify(record, null, 2)}\n`, words };
  };

  const draftsIn = (files: Map<string, DraftFiles>): DraftRecord[] =>
    [...files]
      .flatMap(([id, draft]) => draftOf(id, draft) ?? [])
      .toSorted((a, b) => createdAtOf(a) - createdAtOf(b));

  return {
    /** Every draft in the folder, oldest first, as the kept key's value. */
    read(): Record<string, unknown> {
      const disk = readDisk();
      known.clear();
      for (const [id, files] of disk) {
        known.set(id, files);
      }
      return { [DRAFTS_KEY]: draftsIn(disk) };
    },

    /**
     * Brings what the window kept and what is on disk together after the
     * folder changed under the app: a draft whose files changed is taken from
     * disk, one whose folder went is dropped, and the rest are left as the
     * window has them. Undefined when nothing changed but the app's own writes.
     */
    reconcile(current: Record<string, unknown>) {
      const disk = readDisk();
      const changed = new Set<string>();
      for (const [id, files] of disk) {
        const was = known.get(id);
        if (was?.record !== files.record || was.words !== files.words) {
          changed.add(id);
        }
      }
      const removed = [...known.keys()].filter((id) => !disk.has(id));
      if (changed.size === 0 && removed.length === 0) {
        return undefined;
      }
      known.clear();
      for (const [id, files] of disk) {
        known.set(id, files);
      }
      const fromDisk = new Map(
        draftsIn(disk).map((draft) => [draft.id, draft]),
      );
      const kept = draftsOf(current[DRAFTS_KEY]).flatMap((draft) => {
        const onDisk = fromDisk.get(draft.id);
        if (onDisk === undefined) {
          return [];
        }
        return [changed.has(draft.id) ? onDisk : draft];
      });
      const keptIds = new Set(kept.map((draft) => draft.id));
      const added = [...fromDisk.values()].filter(
        (draft) => !keptIds.has(draft.id),
      );
      return { [DRAFTS_KEY]: [...kept, ...added] };
    },

    /**
     * Writes the drafts the window keeps: each one's files where they
     * changed, and the folder of each it no longer has removed, with
     * everything in it.
     */
    write(keys: Record<string, unknown>) {
      const value = keys[DRAFTS_KEY];
      if (!Array.isArray(value)) {
        return;
      }
      const drafts = draftsOf(value);
      const ids = new Set(drafts.map((draft) => draft.id));
      for (const id of known.keys()) {
        if (!ids.has(id)) {
          fs.rmSync(draftDirOf(root, id), { force: true, recursive: true });
          known.delete(id);
        }
      }
      for (const draft of drafts) {
        const files = filesOf(draft);
        const was = known.get(draft.id);
        const dir = draftDirOf(root, draft.id);
        if (was?.words !== files.words) {
          writeAtomic(path.join(dir, WORDS_FILE_NAME), files.words);
        }
        if (was?.record !== files.record) {
          writeAtomic(recordPathOf(dir), files.record);
        }
        known.set(draft.id, files);
      }
    },

    /**
     * Calls back when the folder changes, its contents or a draft's files,
     * gathered over a beat. The app's own writes call back too; `reconcile`
     * is what tells them apart.
     */
    watch(onChange: () => void): () => void {
      let watcher: fs.FSWatcher | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        fs.mkdirSync(root, { recursive: true });
        watcher = fs.watch(root, { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(onChange, WATCH_SETTLE_MS);
        });
        watcher.on("error", (error) => {
          logger.warn(`Stopped watching drafts in ${root}`, error);
          watcher?.close();
        });
      } catch (error) {
        logger.warn(`Could not watch drafts in ${root}`, error);
      }
      return () => {
        clearTimeout(timer);
        watcher?.close();
      };
    },
  };
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

/** Every draft in a kept value that names itself: an id fit for a folder, and words. */
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

function createdAtOf(draft: DraftRecord): number {
  return typeof draft.createdAt === "number" ? draft.createdAt : 0;
}

/** A record with each attachment's path passed through `map`. */
function withPaths(
  record: object,
  map: (file: string) => string,
): Record<string, unknown> {
  const entries = Object.fromEntries(Object.entries(record));
  if (!Array.isArray(entries.attached)) {
    return entries;
  }
  return {
    ...entries,
    attached: entries.attached.map((item: unknown) =>
      item !== null &&
      typeof item === "object" &&
      "path" in item &&
      typeof item.path === "string"
        ? { ...item, path: map(item.path) }
        : item,
    ),
  };
}

/** Writes a file whole through a sibling, so a crash mid-write leaves the old one. */
function writeAtomic(file: string, content: string) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid.toString()}.tmp`;
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    logger.error(`Could not write ${file}`, error);
  }
}
