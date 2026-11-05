import { formatDuration } from "@/client/lib/format-time";
import { type Turn } from "@instrument-org/workspace/client";

/**
 * The words of a finished turn's folded line: the summary a side call wrote,
 * or, until it does and if it never does, how long the work took.
 */
export function workedLine(turn: Pick<Turn, "summary" | "workedMs">): string {
  return turn.summary ?? `Worked for ${formatDuration(turn.workedMs)}`;
}
