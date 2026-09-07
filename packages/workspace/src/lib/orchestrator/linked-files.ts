import { sort, unique } from "radashi";

import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";

/**
 * How far back into a channel this reads. A file the conversation handed over
 * a hundred messages ago is history rather than a recent, and the point of a
 * bound is that a channel a year old costs the same to ask as a new one.
 */
const MESSAGES_READ = 100;

/** A file the conversation showed the user, and when it showed it. */
export interface LinkedFile {
  at: number;
  /** The path as the reply named it, which is the path the agent can reach it by. */
  path: string;
}

/**
 * The files the conversation has put on screen, newest first.
 *
 * What the agent chose to show is the whole of it: a `files` fence or a link
 * to a path, the two things a reply draws as something to open. Read back out
 * of what was said rather than recorded as it happened, so it needs nothing
 * kept up to date and says the same thing after a restart. Every channel is
 * asked, since the user saw all of them.
 *
 * A path here is what the user was shown, not a promise that anything is still
 * there; the file may have been moved or thrown away since.
 */
export async function linkedFiles(
  orchestratorTaskId: TaskId,
): Promise<LinkedFile[]> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  const shown = await Promise.all(
    (state.channels ?? []).map((channel) =>
      shownIn(orchestratorTaskId, channel.id),
    ),
  );
  // Newest first, then one entry per file: a file handed over again is the
  // same file, and the time that matters is the last time it was shown.
  return unique(
    sort(shown.flat(), (file) => file.at, true),
    (file) => file.path,
  );
}

/** What one channel's replies showed. */
async function shownIn(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<LinkedFile[]> {
  const ids = await Store.getMessageIds(sessionId, taskId);
  if (ids.isErr()) {
    return [];
  }
  const messages = await Store.getMessagesWithParts({
    messageIds: ids.value.slice(-MESSAGES_READ),
    sessionId,
    taskId,
  });
  if (messages.isErr()) {
    return [];
  }
  return messages.value.flatMap((message) =>
    message.role === "assistant"
      ? [...pathsNamedInMessage(message)].map((path) => ({
          at: message.metadata.createdAt.getTime(),
          path,
        }))
      : [],
  );
}
