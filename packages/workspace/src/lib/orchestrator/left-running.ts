import ms from "ms";

import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";

/**
 * One thing a task has running in the background, as its finish event and its
 * status lines carry it.
 */
export type LeftRunning = NonNullable<
  SessionMessageDataPart.TaskEventDataPart["events"][number]["running"]
>[number];

/**
 * The most of a command a status line carries. A search with six globs runs
 * past two hundred characters, and the line exists to say what a process is,
 * not to be rerun.
 */
const COMMAND_MAX_LENGTH = 80;

/**
 * One process in a line: its id, its command cut to fit, and how long it has
 * been running. The id is what `task kill` takes, so it leads.
 */
export function describeLeftRunning({
  command,
  id,
  runningForMs,
}: LeftRunning): string {
  const oneLine = command.replaceAll(/\s+/g, " ").trim();
  const shown =
    oneLine.length > COMMAND_MAX_LENGTH
      ? `${oneLine.slice(0, COMMAND_MAX_LENGTH - 1)}…`
      : oneLine;
  return `${id} \`${shown}\` (${ms(Math.max(1000, runningForMs), { long: true })})`;
}
