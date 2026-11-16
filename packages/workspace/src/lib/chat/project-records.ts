import { z } from "zod";

import { type DeviceId } from "../records/device-id";
import { applySyncedOps, foldSyncedFiles } from "../synced-store/synced-files";
import { type SyncedOp } from "../synced-store/synced-record";
import { workspaceLayout } from "../workspace-layout";

/**
 * What the app keeps about each project, apart from the person's own words:
 * a synced store (`docs/architecture/synced-stores.md`), each device
 * appending to its own `.instrument/devices/<device>/projects.jsonl`, a key
 * per project by its id, newest winning per key.
 *
 * A project's folder in `Projects/` is the project, and its `AGENTS.md`, when
 * it has one, is only the person's instructions, which other agents opened in
 * the folder read as their own. Everything else about it (its id, its mark,
 * when it was made, whether it is retired) is here, so editing or rewriting
 * the file, by hand or by another agent, never changes what the app knows
 * about the project. A record names its project's folder by name, which is
 * how a folder finds its record (`matchProjectFolders`).
 */

export const PROJECTS_DOMAIN = "projects";

export const ProjectRecordSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on. */
  color: z.string().optional(),
  /** When it was made, so the menus stay in the order they were made in. */
  created: z.iso.datetime({ offset: true }),
  /** What stands for it: one emoji. */
  emoji: z.string().optional(),
  /** Its folder's name in `Projects/`, which is its name. */
  folder: z.string().min(1),
  /** A Phosphor icon's name, in place of an emoji. A project has one or the other. */
  icon: z.string().optional(),
  /** The 1.x project it was joined to, when it was made from or joined to one. */
  legacyId: z.string().optional(),
  /** Out of the menus, with the chats that carry it left alone. */
  retired: z.literal(true).optional(),
});

export type ProjectRecord = z.output<typeof ProjectRecordSchema>;

/** Every project's record, by its id, as every device's file has it now. */
export function readProjectRecords(
  rootDir: string,
): Map<string, ProjectRecord> {
  const fold = foldSyncedFiles({
    devicesDir: workspaceLayout(rootDir).devicesDir,
    domain: PROJECTS_DOMAIN,
  });
  const records = new Map<string, ProjectRecord>();
  for (const [id, value] of fold.entries()) {
    const parsed = ProjectRecordSchema.safeParse(value);
    if (parsed.success) {
      records.set(id, parsed.data);
    }
  }
  return records;
}

/**
 * Writes each record whole under its id, as this device. A record that
 * already says the same writes nothing; one stamped `at` older than what the
 * store has is not written.
 */
export function writeProjectRecords(
  rootDir: string,
  device: DeviceId,
  records: readonly { at?: number; id: string; record: ProjectRecord }[],
): void {
  if (records.length === 0) {
    return;
  }
  applySyncedOps({
    device,
    devicesDir: workspaceLayout(rootDir).devicesDir,
    domain: PROJECTS_DOMAIN,
    ops: records.map(
      ({ at, id, record }): SyncedOp => ({
        ...(at === undefined ? {} : { at }),
        key: id,
        t: "set",
        value: ProjectRecordSchema.parse(record),
      }),
    ),
  });
}

/** What `matchProjectFolders` made of the folders. */
export interface FolderMatch {
  /** Each folder's record by id, for the folders that have one. */
  byFolder: Map<string, string>;
  /** Records taken to have moved to another folder, to write down. */
  renamed: { folder: string; id: string }[];
}

/**
 * Which record is each folder's in `Projects/`.
 *
 * By the folder's name first, then by its name in another case (a rename
 * that only changed case, or a disk that does not tell the two apart).
 * Then by the id a folder's `AGENTS.md` names in front matter an earlier
 * build wrote, where that id's record names no folder there (or there is
 * no record by it, which a launch's sweep writes from the file). Last, a
 * folder renamed in a file manager: when exactly one record's folder is gone
 * and exactly one folder has no record, the folder is that record's, so the
 * project keeps its id and the chats filed under it. Any other folder has no
 * record yet.
 *
 * Where two records name one folder (two devices that each made it before
 * either saw the other's), the smaller id has it.
 */
export function matchProjectFolders({
  fileIds = new Map(),
  folders,
  records,
}: {
  /** The id each folder's `AGENTS.md` names in its front matter, where one does. */
  fileIds?: ReadonlyMap<string, string>;
  folders: readonly string[];
  records: ReadonlyMap<string, Pick<ProjectRecord, "folder">>;
}): FolderMatch {
  const byFolder = new Map<string, string>();
  const claimed = new Set<string>();
  const ids = [...records.keys()].toSorted();
  const claim = (folder: string, id: string) => {
    byFolder.set(folder, id);
    claimed.add(id);
  };
  const present = new Set(folders);
  const unmatched = () => folders.filter((folder) => !byFolder.has(folder));

  for (const id of ids) {
    const folder = records.get(id)?.folder;
    if (folder !== undefined && present.has(folder) && !byFolder.has(folder)) {
      claim(folder, id);
    }
  }
  const renamed: FolderMatch["renamed"] = [];
  const takeAsRenamed = (folder: string, id: string) => {
    claim(folder, id);
    renamed.push({ folder, id });
  };
  // Records whose folder is not there under its own name, for the steps after.
  const gone = () =>
    ids.filter((id) => {
      const folder = records.get(id)?.folder;
      return !claimed.has(id) && folder !== undefined && !present.has(folder);
    });
  for (const folder of unmatched()) {
    const id = gone().find(
      (each) =>
        records.get(each)?.folder.toLowerCase() === folder.toLowerCase(),
    );
    if (id !== undefined) {
      takeAsRenamed(folder, id);
    }
  }
  for (const folder of unmatched()) {
    const id = fileIds.get(folder);
    if (id === undefined || claimed.has(id)) {
      continue;
    }
    if (!records.has(id)) {
      claim(folder, id);
    } else if (gone().includes(id)) {
      takeAsRenamed(folder, id);
    }
  }
  const left = unmatched();
  const missing = gone();
  const [folder] = left;
  const [id] = missing;
  if (
    left.length === 1 &&
    missing.length === 1 &&
    folder !== undefined &&
    id !== undefined
  ) {
    takeAsRenamed(folder, id);
  }
  return { byFolder, renamed };
}
