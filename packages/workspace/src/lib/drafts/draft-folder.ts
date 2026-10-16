import fs from "node:fs";
import path from "node:path";

import { DRAFT_FILE_NAME, DRAFTS_FOLDER_NAME } from "../../constants";
import { claimFolderNamedSync, safeName } from "../chat-folders/folder-name";
import {
  type DraftFile,
  isDraftFileName,
  parseDraftFile,
  renderDraftFile,
} from "./draft-file";

/**
 * Where the person's drafts are: `Drafts/<date>/`, a folder per draft with
 * the draft in it and what was pasted into it beside the draft.
 *
 * The folder is named for the day the draft was started, numbered beside the
 * ones already there (`2026-10-14`, then `2026-10-14 2`), because a name from
 * the draft's words would rename itself while someone typed. A draft made all
 * at once, which nobody is typing into, may be named for its words instead.
 *
 * The name is taken by making the folder, which the system does in one step,
 * rather than by listing what is there and picking what is free: two drafts
 * started at the same moment would otherwise both pick that name and share a
 * folder.
 *
 * Nothing here reads a folder's name as a draft's identity. A draft is its
 * `id`, so a folder renamed or moved in a file manager still holds the draft
 * it held, and a folder holding two drafts (two devices, each offline on the
 * same day, or a sync engine's conflict copy) is read as two.
 *
 * Synchronous, because the app writes the drafts the windows keep on a timer
 * and again as it quits, and a quit runs no promise to its end. Each call is
 * a listing of one shallow folder and a file or two.
 */

/** A draft and where it is. */
export interface DraftOnDisk {
  /** The folder the draft is in, which what it pasted is beside. */
  dir: string;
  draft: DraftFile;
  /** The draft's own file, which is only one of what the folder may hold. */
  file: string;
}

/** Where every draft is: `Drafts/` at the workspace's top level. */
export function draftsFolderDir(rootDir: string): string {
  return path.join(rootDir, DRAFTS_FOLDER_NAME);
}

/**
 * Every draft in the folder, oldest first. A folder with no draft in it is
 * passed over, and so is a file that names no draft; a draft whose id another
 * one already has is kept beside it rather than dropped, since one of the two
 * is a copy of the other and choosing between them is nobody's to do here.
 */
export function readDrafts(rootDir: string): DraftOnDisk[] {
  const drafts = draftsFolderDir(rootDir);
  let folders: string[];
  try {
    folders = fs
      .readdirSync(drafts, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const found: DraftOnDisk[] = [];
  for (const folder of folders.toSorted()) {
    const dir = path.join(drafts, folder);
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((name) => isDraftFileName(name));
    } catch {
      continue;
    }
    for (const name of names.toSorted()) {
      const file = path.join(dir, name);
      const draft = readDraftFile(file);
      if (draft) {
        found.push({ dir, draft, file });
      }
    }
  }
  // Oldest first, and for two started in the same moment by id, which is a
  // ULID and so carries the order they were made in; two files holding one
  // draft (a conflict copy beside its original) sort by name.
  return found.toSorted(
    (a, b) =>
      a.draft.created.getTime() - b.draft.created.getTime() ||
      a.draft.id.localeCompare(b.draft.id) ||
      a.file.localeCompare(b.file),
  );
}

/** One draft by its file, or nothing where the file is gone or names no draft. */
function readDraftFile(file: string): DraftFile | undefined {
  try {
    return parseDraftFile(fs.readFileSync(file, "utf8"), {
      at: fs.statSync(file).mtime,
    });
  } catch {
    return undefined;
  }
}

/** The draft with this id and where it is, or nothing where there is none. */
export function findDraft(
  rootDir: string,
  draftId: string,
): DraftOnDisk | undefined {
  return readDrafts(rootDir).find((entry) => entry.draft.id === draftId);
}

/**
 * The folder the draft is in, made if it is not there: the one already
 * holding a draft with this id, and otherwise a free name under `named` or
 * the day the draft was started.
 *
 * Asked again for the same draft, it answers with the folder it made, so a
 * paste that arrives before the first autosave and the autosave that follows
 * it land in one folder. The draft's file is written with it, because that
 * file is the only thing on disk that says which draft the folder is for.
 */
export function ensureDraftFolder({
  draft,
  named,
  rootDir,
  timeZone,
}: {
  draft: DraftFile;
  /** What to name the folder, for a draft nobody is typing into. */
  named?: string;
  rootDir: string;
  /** The zone the day in the folder's name is read in: the writing device's own. */
  timeZone: string;
}): DraftOnDisk {
  const already = findDraft(rootDir, draft.id);
  if (already) {
    return already;
  }
  const claimed = claimFolderNamedSync(
    draftsFolderDir(rootDir),
    named === undefined ? dayName(draft.created, timeZone) : safeName(named),
  );
  const file = path.join(claimed.path, DRAFT_FILE_NAME);
  writeDraftFile(file, draft);
  return { dir: claimed.path, draft, file };
}

/**
 * Writes a draft whole, through a temp name that no sync engine carries and a
 * rename over whatever was there, so a reader sees one draft or the one
 * before it and a crash mid-write leaves the older file.
 */
export function writeDraftFile(file: string, draft: DraftFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.~${path.basename(file)}.${process.pid.toString()}.tmp`,
  );
  fs.writeFileSync(temp, renderDraftFile(withOthersKept(file, draft)), "utf8");
  fs.renameSync(temp, file);
}

/**
 * The draft with whatever front matter the file already held that this build
 * does not write. The window hands over what it knows, which is this build's
 * keys and no others, so the keeping is done here: every write goes through
 * this one place, whoever asked for it, and a key the phone or a newer build
 * left is still there afterwards. What the caller carries wins, so a key that
 * becomes one of ours takes its new value.
 */
function withOthersKept(file: string, draft: DraftFile): DraftFile {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return draft;
  }
  const others = {
    ...parseDraftFile(text, { at: draft.updated })?.others,
    ...draft.others,
  };
  return Object.keys(others).length > 0 ? { ...draft, others } : draft;
}

/**
 * Takes a draft away: its own file, what was pasted into it, and its folder
 * once that leaves it empty. The folder stays where it holds another draft or
 * anything the person put there themselves.
 */
export function removeDraft({ dir, draft, file }: DraftOnDisk): void {
  for (const item of draft.attached ?? []) {
    if (!path.isAbsolute(item.path)) {
      fs.rmSync(path.join(dir, item.path), { force: true, recursive: true });
    }
  }
  fs.rmSync(file, { force: true });
  try {
    fs.rmdirSync(dir);
  } catch {
    // Something else is in the folder: another draft, or the person's own
    // file. Theirs to keep.
  }
}

/** The day a draft was started, as its folder is named for it. */
function dayName(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}
