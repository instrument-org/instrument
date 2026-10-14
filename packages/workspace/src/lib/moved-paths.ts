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
 * behind (a chat's records, which stay where its work was) names only the
 * rest.
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
 * so is the record. For whatever reads back a path it kept (the agent's
 * file tools and the person's file views over an old reply, the recent
 * files, a draft's attachments) rather than for anything that writes one.
 */
export function remapMovedPath(
  hostPath: string,
  moves: readonly MovedPath[] = workspaceMovedPaths(),
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  let current = hostPath;
  for (let step = 0; step < MAX_MOVES_FOLLOWED; step++) {
    if (exists(current)) {
      return current;
    }
    const move = deepestMoveHolding(current, moves);
    if (move === undefined) {
      return current;
    }
    current = path.join(move.to, move.relative);
  }
  return current;
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

function deepestMoveHolding(
  hostPath: string,
  moves: readonly MovedPath[],
): (MovedPath & { relative: string }) | undefined {
  let best: (MovedPath & { relative: string }) | undefined;
  for (const move of moves) {
    const relative = hostPathWithin(move.from, hostPath);
    if (
      relative !== null &&
      (best === undefined || move.from.length > best.from.length)
    ) {
      best = { ...move, relative: relative === "/" ? "." : `.${relative}` };
    }
  }
  return best;
}
