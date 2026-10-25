import fs from "node:fs";
import path from "node:path";
import { unique } from "radashi";
import { ulid } from "ulid";

import { DRAFT_FILE_NAME, DRAFTS_FOLDER_NAME } from "../../constants";
import { claimFolderNamedSync, safeName } from "../chat-folders/folder-name";
import { isSystemClutter, removeFolderLeftEmpty } from "../system-clutter";
import { pastedPathOf } from "./context-line";
import {
  type DraftFile,
  isDraftFileName,
  parseDraftFile,
  renderDraftFile,
} from "./draft-file";

/**
 * Where the person's drafts are: `Drafts/<date>/`, a folder per draft with
 * the draft in it and everything that goes with its message beside the
 * draft ({@link draftFolderItems}).
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
  /** The folder the draft is in, which what goes with it is beside. */
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
 * passed over, and so is a file that cannot be read as one; a draft whose id
 * another one already has is kept beside it rather than dropped, since one of
 * the two is a copy of the other and choosing between them is nobody's to do
 * here. A draft written with no `id` is given one, written into its file.
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

/**
 * One draft by its file, or nothing where the file is gone or cannot be read
 * as one. A draft the file names no `id` for is given one, and the file is
 * written with it, so the next read, here or on another device, finds the
 * same draft.
 */
function readDraftFile(file: string): DraftFile | undefined {
  try {
    const newId = ulid();
    const draft = parseDraftFile(fs.readFileSync(file, "utf8"), {
      at: fs.statSync(file).mtime,
      newId,
    });
    if (draft?.id === newId) {
      writeDraftFile(file, draft);
    }
    return draft;
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

/** A file or folder in a draft's folder that goes with its message. */
export interface DraftFolderItem {
  kind: "file" | "folder";
  path: string;
}

/**
 * Whether the files beside a draft in its folder are that draft's: every
 * `DRAFT*.md` there is this one draft (a sync engine's conflict copy is the
 * same draft again). A folder holding two different drafts says nothing about
 * which of them a loose file is for, so in one like that each draft has only
 * what its own `context` lines name inside the folder, and a file no line
 * names goes with neither.
 */
export function ownsDraftFolder(dir: string, id: string): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => isDraftFileName(name));
  } catch {
    return true;
  }
  if (names.length <= 1) {
    return true;
  }
  return names.every((name) => {
    const file = path.join(dir, name);
    try {
      return (
        parseDraftFile(fs.readFileSync(file, "utf8"), {
          at: fs.statSync(file).mtime,
        })?.id === id
      );
    } catch {
      // Gone since the listing: one draft fewer to share with.
      return true;
    }
  });
}

/**
 * What in a draft's folder goes with its message: every file and folder
 * beside its `DRAFT*.md` but the system's clutter, in a folder the draft owns
 * ({@link ownsDraftFolder}), and otherwise what its lines name there. The
 * folder is the record of what was attached, so a file dropped in from a
 * file manager is attached and one taken out is not.
 */
export function draftFolderItems({
  dir,
  draft,
}: Pick<DraftOnDisk, "dir" | "draft">): DraftFolderItem[] {
  if (!ownsDraftFolder(dir, draft.id)) {
    return unique(
      (draft.context ?? []).flatMap((line) => {
        const target = pastedIntoThisDraft(dir, line);
        const kind = target === undefined ? undefined : kindOf(target);
        return target === undefined || kind === undefined
          ? []
          : [{ kind, path: target }];
      }),
      (item) => item.path,
    );
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => !isDraftFileName(name) && !isSystemClutter(name))
    .toSorted()
    .flatMap((name) => {
      const target = path.join(dir, name);
      const kind = kindOf(target);
      return kind === undefined ? [] : [{ kind, path: target }];
    });
}

/**
 * Where `target` really is, when it is something in the draft's folder that
 * goes with it, and so something taking its chip off may move to the Trash:
 * an entry directly in the folder, reached without a link on the way, other
 * than a draft's file or the folder itself. Nothing for anything else, which
 * a path a window sent can name.
 */
export function draftFolderItemAt(
  dir: string,
  target: string,
): string | undefined {
  const name = path.basename(target);
  if (name === "" || name === "." || name === ".." || isDraftFileName(name)) {
    return undefined;
  }
  const holder = realPathOf(path.dirname(target));
  if (holder === undefined || holder !== realPathOf(dir)) {
    return undefined;
  }
  const at = path.join(holder, name);
  return kindOf(at) === undefined ? undefined : at;
}

/**
 * Takes away a draft: its own file, and its folder once that leaves it empty.
 *
 * Nothing else in the folder is deleted here. A send moves what it sent out
 * of the folder itself (`removeSentFromDraft`), so whatever is still there
 * was never sent: something that arrived after the send read the folder, or
 * the whole of a draft thrown away. Any of it may be the only copy of
 * something the person dragged in, so it is handed back for the caller to
 * move to the Trash, after which the folder can go.
 *
 * In a folder another draft shares, only what this draft's lines name and
 * the other's do not is this draft's.
 */
export function removeDraft(entry: DraftOnDisk): DraftFolderItem[] {
  const { dir, draft, file } = entry;
  const others = namedByOtherDrafts(dir, draft.id);
  const mine = draftFolderItems(entry).filter((item) => !others.has(item.path));
  fs.rmSync(file, { force: true });
  // Something else in the folder keeps it: another draft, or what is left
  // for the Trash.
  removeFolderLeftEmpty(dir);
  return mine;
}

/**
 * What {@link removeDraft} handed back, to the Trash one by one, and the
 * draft's folder after them once that leaves it empty. One that cannot be
 * moved stays where it is, never deleted outright, and is named in what this
 * answers.
 */
export async function trashLeftInDraft({
  dir,
  left,
  moveToTrash,
}: {
  dir: string;
  left: readonly DraftFolderItem[];
  moveToTrash: (target: string) => Promise<void>;
}): Promise<{ error: unknown; path: string }[]> {
  const kept: { error: unknown; path: string }[] = [];
  for (const item of left) {
    try {
      await moveToTrash(item.path);
    } catch (error) {
      kept.push({ error, path: item.path });
    }
  }
  // Something still in it keeps it: another draft, or what could not be moved.
  removeFolderLeftEmpty(dir);
  return kept;
}

/**
 * What the folder's other drafts name inside it, by where it really is, in a
 * folder this draft does not own; nothing in one it does, where every draft
 * file is this draft.
 */
export function namedByOtherDrafts(dir: string, id: string): Set<string> {
  return ownsDraftFolder(dir, id) ? new Set() : pastedIntoOthers(dir, id);
}

/**
 * Where a file this draft names really is, when its line names a place
 * inside the draft's own folder, which is how a draft in a folder it shares
 * says what is its own. Nothing for a line naming anything else.
 *
 * A draft file is a document someone can edit, so `../../their-work` is a
 * path it can hold, and a folder on the way can be a link out. Taking the
 * draft away must not take anything but the draft's with it, so both are
 * read as naming something that is not the draft's.
 */
function pastedIntoThisDraft(dir: string, line: string): string | undefined {
  // A folder's line ends in `/`, and names the folder all the same.
  const named = pastedPathOf(line.trim().replace(/(?<=.)[/\\]+$/, ""));
  if (named === undefined) {
    return undefined;
  }
  const target = path.resolve(dir, named);
  if (!inFolder(dir, target)) {
    return undefined;
  }
  // Where the folder holding it really is, so a link on the way out is seen
  // for what it is. The entry itself is left as it is: removing a link
  // removes the link.
  const holder = realPathOf(path.dirname(target));
  const folder = realPathOf(dir);
  if (
    holder === undefined ||
    folder === undefined ||
    (holder !== folder && !inFolder(folder, holder))
  ) {
    return undefined;
  }
  return path.join(holder, path.basename(target));
}

/** A folder's entry as a file or a folder, by the entry itself, or nothing where it is gone. */
function kindOf(target: string): DraftFolderItem["kind"] | undefined {
  try {
    return fs.lstatSync(target).isDirectory() ? "folder" : "file";
  } catch {
    return undefined;
  }
}

/** Whether `target` is something inside `folder` rather than the folder itself. */
function inFolder(folder: string, target: string): boolean {
  const within = path.relative(folder, target);
  return within !== "" && !within.startsWith("..") && !path.isAbsolute(within);
}

function realPathOf(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}

/**
 * What the folder's other drafts name inside it, which this one shares rather
 * than owns. Taking one draft away leaves what another still names.
 */
function pastedIntoOthers(dir: string, id: string): Set<string> {
  const shared = new Set<string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => isDraftFileName(name));
  } catch {
    return shared;
  }
  for (const name of names) {
    const other = readDraftFile(path.join(dir, name));
    if (other === undefined || other.id === id) {
      continue;
    }
    for (const line of other.context ?? []) {
      const pasted = pastedIntoThisDraft(dir, line);
      if (pasted !== undefined) {
        shared.add(pasted);
      }
    }
  }
  return shared;
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
