import { z } from "zod";

import { heldStore, type WorkspacePlace } from "../synced-store/held-stores";
import { type SyncedStore } from "../synced-store/synced-store";
import {
  type SyncedOp,
  withUnknownFieldsOf,
} from "../synced-store/synced-record";

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

/** The projects store of the workspace this process runs, or of the one `place` names. */
export function projectsStore(place?: WorkspacePlace): Promise<SyncedStore> {
  return heldStore("projects", place);
}

/** Every project's record, by its id. */
export function projectRecords(store: SyncedStore): Map<string, ProjectRecord> {
  const records = new Map<string, ProjectRecord>();
  for (const [id, value] of store.entries()) {
    const parsed = ProjectRecordSchema.safeParse(value);
    if (parsed.success) {
      records.set(id, parsed.data);
    }
  }
  return records;
}

/**
 * Writes each record whole under its id, with any field a newer build added
 * to the stored one kept. A record that already says the same writes nothing; one stamped `at` older than what the store has is not
 * written.
 */
export function writeProjectRecords(
  store: SyncedStore,
  records: readonly { at?: number; id: string; record: ProjectRecord }[],
): Promise<void> {
  return store.apply(
    records.map(
      ({ at, id, record }): SyncedOp => ({
        ...(at === undefined ? {} : { at }),
        key: id,
        t: "set",
        value: withUnknownFieldsOf(
          store.get(id),
          ProjectRecordSchema.parse(record),
          ProjectRecordSchema.shape,
        ),
      }),
    ),
  );
}
