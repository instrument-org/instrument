import { MOUNT } from "../../mount-points";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { Store } from "../store";

/**
 * The most files one task's finish reports. A task that wrote a hundred of
 * them is one whose folder the conversation should open, not one whose note
 * should be a hundred lines long.
 */
const MAX_FILES = 8;

/**
 * The files a task wrote, in the paths its orchestrator can actually open.
 *
 * A task's answer is meant to be a thing on disk, and the only thing that
 * traveled back was the first 400 characters of whatever it said -- so a task
 * that wrote the file and described it in its second paragraph handed the
 * conversation nothing it could link, and the conversation went looking for it
 * with `find`. Reading the writes out of the transcript says what was made
 * whether or not the task remembered to mention it.
 *
 * The paths are translated on the way out. A task writes `output/report.md`
 * relative to its own folder, which is not a path that resolves anywhere in
 * the conversation's shell; the same file is `/tasks/<id>/output/report.md`
 * there. A path already under a shared mount is left alone, because that mount
 * is the same folder for both of them.
 */
export async function filesWrittenBy({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<string[]> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  if (messages.isErr()) {
    return [];
  }
  const paths = new Set<string>();
  for (const message of messages.value) {
    for (const part of message.parts) {
      if (part.type !== "tool-write_file" && part.type !== "tool-edit_file") {
        continue;
      }
      if (part.state !== "output-available") {
        continue;
      }
      const filePath: unknown = part.input.filePath;
      if (typeof filePath !== "string" || filePath.trim() === "") {
        continue;
      }
      paths.add(asOrchestratorPath({ filePath, taskId }));
    }
  }
  return [...paths].slice(-MAX_FILES);
}

function asOrchestratorPath({
  filePath,
  taskId,
}: {
  filePath: string;
  taskId: TaskId;
}): string {
  if (filePath.startsWith("/")) {
    return filePath;
  }
  return `${MOUNT.tasks}/${taskId}/${filePath.replace(/^\.\//, "")}`;
}
