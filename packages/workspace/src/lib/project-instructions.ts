import {
  MAX_PROJECT_INSTRUCTIONS_LENGTH,
  PROJECT_INSTRUCTIONS_FILE_NAME,
  PROJECT_MOUNT_POINT,
} from "../constants";

/**
 * The model-facing form of a project's instructions: trimmed, whitespace-only
 * treated as absent, and cut to `MAX_PROJECT_INSTRUCTIONS_LENGTH`.
 *
 * The one place the cap is applied, so the standing session context, the
 * snapshot frozen onto a task's first message, the mid-task change note and the
 * transcript all bound the same text the same way. That is what covers the
 * instructions the cap cannot reach at the point they are written: an
 * `AGENTS.md` the user pasted into outside the app, and snapshots frozen onto
 * tasks that predate the cap. Both pass through here on their way to the model.
 *
 * `Project.instructions` stays the whole file -- only what is sent is cut, so
 * the editor still shows the user everything they wrote.
 *
 * The cut lands on a paragraph break rather than mid-sentence, so the last
 * surviving instruction is a whole one, and the block says where the rest is:
 * the project folder is mounted, so the model can read the file when the tail
 * matters.
 *
 * Its own module, rather than sitting with the rest of the project helpers, so
 * the parts of this that the renderer shares (`projectChangesModelNote`) can
 * apply the same cap without importing anything that touches disk.
 */
export function normalizeProjectInstructions(
  instructions: string,
): string | undefined {
  const trimmed = instructions.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length <= MAX_PROJECT_INSTRUCTIONS_LENGTH) {
    return trimmed;
  }

  const withinBudget = trimmed.slice(0, MAX_PROJECT_INSTRUCTIONS_LENGTH);
  const lastBreak = withinBudget.lastIndexOf("\n\n");
  // A wall of text with no blank line inside the budget has no break to cut back
  // to, and cutting to the start would send no instructions at all, so that
  // falls back to the character count.
  const kept =
    lastBreak > 0 ? withinBudget.slice(0, lastBreak) : withinBudget.trimEnd();

  return `${kept}\n\n[Cut off here: these instructions are too long to include in full. The rest is in ${PROJECT_MOUNT_POINT}/${PROJECT_INSTRUCTIONS_FILE_NAME} -- read that file if you need it.]`;
}
