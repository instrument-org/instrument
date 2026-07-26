import fs from "node:fs/promises";
import path from "node:path";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getWorkspaceSkillsDir } from "./workspace-fs-layout";

export interface WorkspaceSkillChanges {
  created: string[];
  removed: string[];
  updated: string[];
}

/**
 * Skill directory name -> the stamp of its SKILL.md, for the workspace skills
 * directory only.
 *
 * That directory is the whole of what an agent can install or revise (the
 * writable `/skills` mount), so a change here is the complete answer to "did
 * this turn touch a skill" -- every other source is read-only to the agent.
 */
export type WorkspaceSkillIndex = Map<string, SkillStamp>;

interface SkillStamp {
  mtimeMs: number;
  size: number;
}

/**
 * Per-turn snapshots, keyed by task and session so concurrent tasks writing to
 * the shared skills directory each diff against their own turn's start.
 */
const TURNS = new Map<string, WorkspaceSkillIndex>();

interface TurnKey {
  id: TaskId;
  sessionId: StoreId.Session;
}

/** Snapshots the skills directory as a turn's "before" state. */
export async function beginSkillChangeTracking(turn: TurnKey): Promise<void> {
  TURNS.set(turnKey(turn), await readWorkspaceSkillIndex());
}

/**
 * Diffs the skills directory against the turn's "before" snapshot and drops it.
 * Safe to call unconditionally; reports nothing when the turn was not tracked.
 */
export async function consumeSkillChanges(
  turn: TurnKey,
): Promise<WorkspaceSkillChanges> {
  const key = turnKey(turn);
  const before = TURNS.get(key);
  TURNS.delete(key);
  if (!before) {
    return emptyChanges();
  }
  return diffWorkspaceSkillIndexes({
    after: await readWorkspaceSkillIndex(),
    before,
  });
}

/**
 * What changed between two snapshots.
 *
 * An update is detected from SKILL.md alone, so a revision that only rewrites a
 * script or reference the skill ships goes unreported. Reading every file of
 * every skill to catch those would cost far more than the signal is worth, and
 * the case this exists for -- a skill appearing -- is exact either way.
 */
export function diffWorkspaceSkillIndexes({
  after,
  before,
}: {
  after: WorkspaceSkillIndex;
  before: WorkspaceSkillIndex;
}): WorkspaceSkillChanges {
  const changes = emptyChanges();

  for (const [name, stamp] of after) {
    const previous = before.get(name);
    if (!previous) {
      changes.created.push(name);
    } else if (
      previous.mtimeMs !== stamp.mtimeMs ||
      previous.size !== stamp.size
    ) {
      changes.updated.push(name);
    }
  }

  for (const name of before.keys()) {
    if (!after.has(name)) {
      changes.removed.push(name);
    }
  }

  return changes;
}

export function hasSkillChanges(changes: WorkspaceSkillChanges): boolean {
  return (
    changes.created.length > 0 ||
    changes.removed.length > 0 ||
    changes.updated.length > 0
  );
}

/**
 * One shallow read of the skills directory plus a stat per entry: cheap enough
 * to run on every turn boundary, which is what makes a skill the agent just
 * wrote reach the UI without watching anything.
 */
export async function readWorkspaceSkillIndex(): Promise<WorkspaceSkillIndex> {
  const skillsDir = getWorkspaceSkillsDir();
  const index: WorkspaceSkillIndex = new Map();

  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    // A workspace with no skills yet has no directory; it is created lazily
    // when the bash filesystem mounts.
    return index;
  }

  await Promise.all(
    entries.map(async (entry) => {
      // Directory symlinks are how a skill gets shared between checkouts, so
      // follow rather than filter: `stat` on the SKILL.md answers both whether
      // the entry is a skill and whether it changed.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        return;
      }
      const stats = await fs
        .stat(path.join(skillsDir, entry.name, "SKILL.md"))
        .catch(() => null);
      if (!stats?.isFile()) {
        return;
      }
      index.set(entry.name, { mtimeMs: stats.mtimeMs, size: stats.size });
    }),
  );

  return index;
}

function emptyChanges(): WorkspaceSkillChanges {
  return { created: [], removed: [], updated: [] };
}

function turnKey({ id, sessionId }: TurnKey): string {
  return `${id}:${sessionId}`;
}
