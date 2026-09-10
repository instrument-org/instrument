import { dedent } from "radashi";

import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";
import { WAKE_SUMMARY_MAX_LENGTH } from "./wake-summary";

/**
 * What a task started by the conversation is told about who reads it.
 *
 * A task's prompt otherwise says "the user" throughout and never mentions that
 * anything else exists, so a task briefed by the conversation writes for a
 * person: a heading, a summary of the file it just wrote, and its sources
 * again underneath. None of that reaches the user. What reaches the
 * conversation is the first few hundred characters of the last thing the task
 * said, which is where those paragraphs go, and the conversation is told never
 * to repeat a file's contents -- so the words are composed, paid for,
 * truncated, and dropped.
 *
 * The conversation reads the task's own folder through a mount of its own
 * (`MOUNT.tasks`), and the note that wakes it lists the files the task wrote,
 * so a path inside the task is one it can open; the task is told so rather
 * than told its paths mean nothing, which left it no path it was allowed to
 * name for a file the brief asked to have in `output/`.
 *
 * Absent for a task the user started directly, whose reader really is a person.
 */
export async function buildBriefContextText(
  taskId: TaskId,
): Promise<null | string> {
  const settings = await getTaskSettings(taskDir(taskId));
  if (!settings?.parentTaskId) {
    return null;
  }
  return dedent`
    <who_reads_you>
    This task was started by the assistant the user is talking to, and its brief is the whole of what that assistant knew to tell you. Nobody is watching this transcript. Your last message is read by that assistant, not by a person, and only its first ${WAKE_SUMMARY_MAX_LENGTH} characters travel, along with the list of files you wrote.

    So: put the answer in a file, and say where it is.
    - The deliverable is the file. Write it, then check it the way the user will see it.
    - Your last message is a receipt, not a report: one or two sentences saying what you made, the verdict in a clause when the brief asked a question, and anything the assistant has to act on -- a question you need answered, a thing you could not do, a judgment call you made. Never a list of findings, a summary of the file, or its sources, even when the brief asks for several: that work is already in the file, the assistant reads the file, and words here are cut at ${WAKE_SUMMARY_MAX_LENGTH} characters and told not to be passed on.
    - Name the deliverable by the path you reach it at: under \`${MOUNT.attachedFolders}/\` when the brief put it in a folder there, or \`output/<name>\` when it lives in this task, which the assistant reads through a folder of its own.
    - When the brief named a folder for the deliverable, that is where it goes, over anything this prompt says about \`output/\`.
    - A folder, a file, or a service you were not handed is not something to ask a person for: stop, and name it in your last message. The assistant can hand it to you and send you on.
    </who_reads_you>
  `;
}
