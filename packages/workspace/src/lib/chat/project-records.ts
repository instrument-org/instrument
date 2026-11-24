import { z } from "zod";

import { type DeviceId } from "../records/device-id";
import {
  applySyncedOps,
  foldSyncedFiles,
  watchSyncedFiles,
} from "../synced-store/synced-files";
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
 * about the project. A folder finds its record by the id its hidden
 * `.instrument-project` names (`PROJECT_ID_FILE_NAME`), which goes with the
 * folder when it is renamed or synced, so a record never names its folder.
 */

export const PROJECTS_DOMAIN = "projects";

const ProjectRecordSchema = z.object({
  /** The agent's line about what goes here, for later. */
  about: z.string().optional(),
  /** The tint its mark is drawn on. */
  color: z.string().optional(),
  /** When it was made, so the menus stay in the order they were made in. */
  created: z.iso.datetime({ offset: true }),
  /** What stands for it: one emoji. */
  emoji: z.string().optional(),
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

/** Calls `onChange` when any device changes a project's record, until stopped. */
export function watchProjectRecords(
  rootDir: string,
  onChange: () => void,
): () => void {
  return watchSyncedFiles({
    devicesDir: workspaceLayout(rootDir).devicesDir,
    domain: PROJECTS_DOMAIN,
    onChange,
  });
}
