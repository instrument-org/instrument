import { systemNote } from "./system-note";

/** A task the agent started after the earlier version, which it no longer sees starting. */
export interface EditedAwayTask {
  handle: string;
  title: string;
  /** Whether the edit stopped it; one that did not run was left as it was. */
  wasRunning: boolean;
}

/**
 * Beside a message the person edited: the conversation after its earlier
 * version is gone, while what was done in it is not.
 */
export function editedMessageNote(tasks: EditedAwayTask[]): string {
  const started =
    tasks.length === 0
      ? ""
      : ` Tasks you started there, oldest first: ${tasks
          .map(
            ({ handle, title, wasRunning }) =>
              `${handle} ${JSON.stringify(title)} (${wasRunning ? "stopped by the edit" : "was not running"})`,
          )
          .join(", ")}.`;
  return systemNote`
    The user edited an earlier message, and this replaces it and everything that came after it, which you no longer see. What was done there still stands: files made or changed, messages sent, commands left running. Check the current state before you repeat any of it.${started}
  `.trim();
}
