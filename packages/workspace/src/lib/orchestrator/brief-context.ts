import { dedent } from "radashi";

import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";

/**
 * What a task started by the conversation is told about who reads it.
 *
 * A task's prompt otherwise says "the user" throughout and never mentions that
 * anything else exists, so a task briefed by the conversation writes for a
 * person: a heading, a summary of the file it just wrote, and its sources
 * again underneath. None of that reaches the user. What reaches the
 * conversation is the first 400 characters of the last thing the task said,
 * which is where those paragraphs go, and the conversation is told never to
 * repeat a file's contents -- so the words are composed, paid for, truncated,
 * and dropped.
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
    This task was started by the assistant the user is talking to, and its brief is the whole of what that assistant knew to tell you. Nobody is watching this transcript. Your last message is read by that assistant, not by a person, and only its first 400 characters travel.

    So: put the answer in a file, and say where it is.
    - The deliverable is the file. Write it, then check it the way the user will see it.
    - Your last message is a receipt, not a report: one or two sentences saying what you made and anything the assistant has to act on -- a question you need answered, a thing you could not do, a judgment call you made. Never summarize the file's contents, never restate its findings, never repeat its sources. That work is already in the file, and saying it here spends the conversation's context on words it is told not to pass on.
    - Name every file you made by a path that resolves outside this task: a folder under \`${MOUNT.attachedFolders}/\` when the brief gave you one, which is the same folder for the assistant as for you. A path of your own like \`output/report.md\` means nothing to it.
    - When the brief named a folder for the deliverable, that is where it goes, over anything this prompt says about \`output/\`.
    </who_reads_you>
  `;
}
