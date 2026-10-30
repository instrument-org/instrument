import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { isRecord } from "../skills";
import { workspaceLayout } from "../workspace-layout";
import { contextLineOf } from "./context-line";
import { type DraftFile } from "./draft-file";
import { ensureDraftFolder, readDrafts, writeDraftFile } from "./draft-folder";

/** Something the old draft was given, by its path: absolute, or relative to its folder. */
interface Attached {
  kind: "file" | "folder";
  path: string;
}

/**
 * Brings the drafts an earlier build hid into the folder the person opens:
 * `.instrument/drafts/<id>/`, whose words were in `draft.md` and whose record
 * was in a `settings.json` beside them, becomes `Drafts/<date>/DRAFT.md` with
 * what was pasted into it beside it.
 *
 * Safe to run again: a draft already in `Drafts/` is left alone, whatever is
 * in the old folder. Nothing is written over and nothing is deleted outright:
 * each draft's files are moved into a folder of its own, and the old folder
 * goes only once it is empty.
 */

export interface DraftsMigration {
  /** A line per draft moved, for the boot log. */
  done: string[];
  /** Each old folder left where it is, with why. */
  left: { reason: string; where: string }[];
}

export async function migrateDraftsToFolder({
  rootDir,
  timeZone,
}: {
  rootDir: string;
  /** The zone the day in a draft's folder name is read in. */
  timeZone: string;
}): Promise<DraftsMigration> {
  const migration: DraftsMigration = { done: [], left: [] };
  const was = workspaceLayout(rootDir).draftsDir;
  let folders: string[];
  try {
    folders = (await fs.readdir(was, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return migration;
  }
  const already = new Set(
    (await readDrafts(rootDir)).map((entry) => entry.draft.id),
  );
  for (const id of folders.toSorted()) {
    const from = path.join(was, id);
    if (already.has(id)) {
      migration.left.push({
        reason: "the draft it holds is already in Drafts",
        where: from,
      });
      continue;
    }
    try {
      migration.done.push(
        await moveDraftFolder({ from, id, rootDir, timeZone }),
      );
      already.add(id);
    } catch (error) {
      migration.left.push({ reason: String(error), where: from });
    }
  }
  await removeIfEmpty(was);
  return migration;
}

/** One old draft folder as a folder in `Drafts/`, and the line that says so. */
async function moveDraftFolder({
  from,
  id,
  rootDir,
  timeZone,
}: {
  from: string;
  id: string;
  rootDir: string;
  timeZone: string;
}): Promise<string> {
  const settings = await readRecord(
    path.join(from, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
  );
  const words = await fs.readFile(path.join(from, "draft.md"), "utf8").catch(
    // Words gone from the folder are a draft with no words, which is what the
    // build that wrote it read too.
    () => "",
  );
  const draft = draftOf({ id, settings, words });
  const { dir, file } = await ensureDraftFolder({ draft, rootDir, timeZone });
  const pasted = await movePasted(from, dir);
  const { attached, missing } = relocate(
    (attachedOf(settings.attached) ?? []).map((item) =>
      path.dirname(item.path) === from
        ? { ...item, path: path.basename(item.path) }
        : item,
    ),
    pasted,
  );
  // What was moved into the new folder goes with the draft by being there.
  const context = attached.flatMap((item) =>
    path.isAbsolute(item.path) ? [contextLineOf(item, { dir, rootDir })] : [],
  );
  writeDraftFile(file, {
    ...draft,
    ...(context.length > 0 ? { context } : {}),
  });
  await fs.rm(path.join(from, "draft.md"), { force: true });
  await fs.rm(path.join(from, PRIVATE_FOLDER_NAME), {
    force: true,
    recursive: true,
  });
  await removeIfEmpty(from);
  return `moved draft ${id} to ${dir}${
    missing.length > 0 ? `, without ${missing.join(", ")}` : ""
  }`;
}

/**
 * Every file the old folder held beside the draft's own, moved into the new
 * one under a free name: what was pasted into the draft, which the draft
 * names by a path relative to its folder. Answers with the new name of each,
 * by the old one.
 */
async function movePasted(
  from: string,
  dir: string,
): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  let names: string[];
  try {
    names = (await fs.readdir(from, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name !== "draft.md")
      .map((entry) => entry.name);
  } catch {
    return moved;
  }
  for (const name of names.toSorted()) {
    const to = await freeName(dir, name);
    await fs.rename(path.join(from, name), path.join(dir, to));
    moved.set(name, to);
  }
  return moved;
}

/**
 * What the draft was given, with each pasted file under the name it moved to.
 * One whose file is not there any more is left out rather than kept as a
 * path to nothing, and named so the log says what the draft lost.
 *
 * A path inside the draft's own folder names one of the files that moved
 * with it, whether the build that wrote it wrote the path in full or
 * relative to the folder.
 */
function relocate(
  attached: Attached[],
  pasted: ReadonlyMap<string, string>,
): { attached: Attached[]; missing: string[] } {
  const missing: string[] = [];
  const kept = attached.flatMap((item) => {
    if (path.isAbsolute(item.path)) {
      return [item];
    }
    const moved = pasted.get(item.path);
    if (moved === undefined) {
      missing.push(item.path);
      return [];
    }
    return [{ ...item, path: moved }];
  });
  return { attached: kept, missing };
}

/** The draft the old folder held, from its words and its record. */
function draftOf({
  id,
  settings,
  words,
}: {
  id: string;
  settings: Record<string, unknown>;
  words: string;
}): DraftFile {
  const { createdAt, topicId, updatedAt } = settings;
  const created = momentOf(createdAt) ?? new Date();
  return {
    created,
    id,
    ...(typeof topicId === "string" && topicId ? { topic: topicId } : {}),
    updated: momentOf(updatedAt) ?? created,
    words,
  };
}

/** What the window kept of each thing the draft was given: its path, and whether it is a folder. */
function attachedOf(value: unknown): Attached[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.path === "string" && entry.path
      ? [
          {
            kind:
              entry.kind === "folder" ? ("folder" as const) : ("file" as const),
            path: entry.path,
          },
        ]
      : [],
  );
  return items.length > 0 ? items : undefined;
}

async function readRecord(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function momentOf(value: unknown): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(Date.parse(value));
  }
  return undefined;
}

/** A name nothing in `dir` holds: the one asked for, or it numbered beside it. */
async function freeName(dir: string, name: string): Promise<string> {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let suffix = 1; ; suffix += 1) {
    const candidate =
      suffix === 1 ? name : `${stem} ${suffix.toString()}${extension}`;
    const taken = await fs
      .stat(path.join(dir, candidate))
      .then(() => true)
      .catch(() => false);
    if (!taken) {
      return candidate;
    }
  }
}

async function removeIfEmpty(dir: string) {
  try {
    await fs.rmdir(dir);
  } catch {
    // Something is still in it, which is the person's or the next sweep's.
  }
}
