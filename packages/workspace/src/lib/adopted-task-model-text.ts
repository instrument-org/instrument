import { MOUNT } from "../mount-points";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { systemNote } from "./system-note";

/** How many of the task's files the note names before it stops. */
const FILES_NAMED_MAX = 20;

/**
 * Tells a chat made from an earlier version's task where its work is. The
 * words above and below are copied from that task, which answered the user
 * itself; the task is one of this chat's own now, and continuing the work is
 * sending it a message rather than starting over.
 */
export function adoptedTaskModelNote(
  data: SessionMessageDataPart.AdoptedTaskDataPart,
) {
  const folder = `${MOUNT.tasks}/${data.taskId}`;
  const named = data.files.slice(0, FILES_NAMED_MAX);
  const more = data.files.length - named.length;
  const files =
    named.length === 0
      ? ""
      : `\nFiles it made:\n${named.map((file) => `- ${file}`).join("\n")}${more > 0 ? `\n- and ${more} more in ${folder}` : ""}`;
  return systemNote`
    This conversation began in an earlier version of the app, where one task talked with the user directly. The replies in it were written by task ${data.taskId}, whose folder is ${folder}. \`${TASK_COMMAND.name} send ${data.taskId}\` continues that task with its whole history, tools and files; a follow-up about this work goes there rather than to a new task.${files}
  `;
}
