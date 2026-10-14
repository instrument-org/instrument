import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { hostPathWithin } from "./host-path";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

/**
 * One move a migration made on this computer: what was under `from` and is
 * not there now is under `to`, at the same place below it. A path already
 * there is never looked for elsewhere, so a move that left some entries
 * behind names only the rest, and a folder whose entries went to several
 * places is one move per place.
 */
const MovedPathSchema = z.object({ from: z.string(), to: z.string() });
export type MovedPath = z.output<typeof MovedPathSchema>;

const MovedPathsFileSchema = z.object({
  moves: z.array(MovedPathSchema).catch([]),
});

/**
 * How many moves one path is followed through: a folder moved twice (a
 * chat's work out of the workspace, then the workspace itself) is found in
 * two steps, and a recorded loop stops here.
 */
const MAX_MOVES_FOLLOWED = 4;

/**
 * The record as last read or written, by its file and the stamp it had then:
 * its modification time and size, since a filesystem that keeps whole
 * seconds gives two writes in one second the same time.
 */
let cached: { file: string; moves: MovedPath[]; stamp: string } | undefined;

/**
 * Where a path stored before a migration moved it is now, by the moves the
 * migrations recorded in the workspace's machine folder: the path itself
 * when it is still there or no move holds it. Paths are this computer's,
 * so is the record. For whatever reads back a path it kept (the person's
 * file views over an old reply, the recent files, a draft's attachments, a
 * chat's grants, a topic's folders) rather than for anything that writes
 * one.
 *
 * A folder whose entries went to more than one place (a chat's old folder:
 * its work to the work folder, its records into the workspace's
 * `.instrument/`) is recorded as one move per place, so every move holding
 * the path is followed, the deepest first, and the first that leads to
 * something there wins. When none does, the deepest one's answer stands.
 */
export function remapMovedPath(
  hostPath: string,
  moves: readonly MovedPath[] = workspaceMovedPaths(),
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  return follow(hostPath, moves, exists, MAX_MOVES_FOLLOWED).path;
}

/** The moves recorded in a machine folder, read again only when the file changes. */
export function readMovedPaths(machineDir: string): MovedPath[] {
  const file = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.movedPaths);
  const stamp = stampOf(file);
  if (stamp === undefined) {
    return [];
  }
  if (cached?.file === file && cached.stamp === stamp) {
    return cached.moves;
  }
  let moves: MovedPath[] = [];
  try {
    const parsed = MovedPathsFileSchema.safeParse(
      JSON.parse(fs.readFileSync(file, "utf8")),
    );
    moves = parsed.success ? parsed.data.moves : [];
  } catch {
    // An unreadable record remaps nothing, as if no move had been made.
  }
  cached = { file, moves, stamp };
  return moves;
}

/**
 * Adds moves to the record in a machine folder, each once. Written beside
 * and renamed into place, so a reader never sees half of it.
 */
export function recordMovedPaths(
  machineDir: string,
  moves: readonly MovedPath[],
): void {
  const recorded = readMovedPaths(machineDir);
  const added = moves.filter(
    (move) =>
      !recorded.some(
        (other) => other.from === move.from && other.to === move.to,
      ),
  );
  if (added.length === 0) {
    return;
  }
  const file = path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.movedPaths);
  fs.mkdirSync(machineDir, { recursive: true });
  const all = [...recorded, ...added];
  const temporary = `${file}.${process.pid.toString()}.tmp`;
  fs.writeFileSync(
    temporary,
    `${JSON.stringify({ moves: all }, undefined, 2)}\n`,
  );
  fs.renameSync(temporary, file);
  const stamp = stampOf(file);
  cached = stamp === undefined ? undefined : { file, moves: all, stamp };
}

function stampOf(file: string): string | undefined {
  try {
    const stats = fs.statSync(file);
    return `${stats.mtimeMs.toString()}:${stats.size.toString()}`;
  } catch {
    return undefined;
  }
}

/** The moves recorded for the workspace this process runs. */
function workspaceMovedPaths(): MovedPath[] {
  return hasWorkspaceConfig()
    ? readMovedPaths(getWorkspaceConfig().workspaceMachineDir)
    : [];
}

/**
 * One path through up to `budget` moves: where it is when it is there, and
 * otherwise the first place a move holding it leads to that is, trying the
 * deepest move first.
 */
function follow(
  hostPath: string,
  moves: readonly MovedPath[],
  exists: (candidate: string) => boolean,
  budget: number,
): { found: boolean; path: string } {
  if (exists(hostPath)) {
    return { found: true, path: hostPath };
  }
  if (budget === 0) {
    return { found: false, path: hostPath };
  }
  let fallback: { found: boolean; path: string } | undefined;
  for (const move of movesHolding(hostPath, moves)) {
    const next = follow(
      path.join(move.to, move.relative),
      moves,
      exists,
      budget - 1,
    );
    if (next.found) {
      return next;
    }
    fallback ??= next;
  }
  return fallback ?? { found: false, path: hostPath };
}

/** Every move holding a path, the deepest first. */
function movesHolding(
  hostPath: string,
  moves: readonly MovedPath[],
): (MovedPath & { relative: string })[] {
  return moves
    .flatMap((move) => {
      const relative = hostPathWithin(move.from, hostPath);
      return relative === null
        ? []
        : [{ ...move, relative: relative === "/" ? "." : `.${relative}` }];
    })
    .toSorted((a, b) => b.from.length - a.from.length);
}
