import { CHAT_FOLDER_NAMES, TASKS_DIR_NAME } from "../constants";

/**
 * The root entries a mount can mask: its private dir, and in a chat's own
 * folder the `tasks/` dir an earlier version kept tasks in, which holds their
 * private dirs and is nothing of the chat's now.
 */
export type MaskedEntry =
  | typeof CHAT_FOLDER_NAMES.private
  | typeof TASKS_DIR_NAME;

/**
 * The masked entry a mount-relative path (as returned by relativeWithin, e.g.
 * `/.instrument` or `/.instrument/state.json`) is or is inside, if any.
 * Compared without case: on a case-insensitive disk, the default on macOS and
 * Windows, `.INSTRUMENT` opens the same directory.
 */
export function maskedEntryOf(
  relativeWithinMount: string,
  entries: readonly MaskedEntry[],
): MaskedEntry | undefined {
  const lower = relativeWithinMount.toLowerCase();
  return entries.find((entry) => {
    const segment = `/${entry.toLowerCase()}`;
    return lower === segment || lower.startsWith(`${segment}/`);
  });
}
