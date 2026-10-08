import { type ByteString } from "just-bash";

import { type Task } from "../../../schemas/task";
import { isWorking } from "../../chat/activity";
import { latestOrNewSessionId } from "../../chat/latest-session";
import { newMessage } from "../../new-message";
import { Store } from "../../store";
import { recordTaskActivity } from "../../task-settings";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { subprocessStdin } from "../utils";
import { type TaskCommandContext } from "./context";
import { chatModel } from "./model-choice";

/**
 * The prompt a subcommand was given: what came on stdin when anything did,
 * else the inline argument. Stdin is the documented route because a quoted
 * heredoc is the one form the shell leaves alone: a `$800` inside double
 * quotes is expanded to `00` before the command ever sees it, and a brief
 * with an apostrophe in it cannot be single-quoted without escaping.
 */
export function promptFrom(inline: string, stdin: ByteString): string {
  const piped = subprocessStdin(stdin)?.toString("utf8").trim();
  return (piped || inline).trim();
}

/**
 * Puts a message into a task: saved at once, so the task's transcript shows it
 * the moment it was sent, then handed to its session, which runs it now when
 * the task is idle and at its next step when it is working (at once, its step
 * in flight stopped, with `interrupt`). Says whether the task was working.
 */
export async function deliver({
  command,
  context,
  interrupt = false,
  prompt,
  task,
}: {
  command: string;
  context: TaskCommandContext;
  interrupt?: boolean;
  prompt: string;
  task: Task;
}) {
  const { model, modelURI } = await chatModel(command, context);
  const session = await latestOrNewSessionId(task.id);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  const message = await newMessage({
    model,
    modelURI,
    prompt,
    sessionId,
    taskId: task.id,
  });
  if (message.isErr()) {
    throw message.error;
  }
  const running = isWorking(task.id);
  const written = await Store.saveMessageWithParts(message.value, task.id);
  if (written.isErr()) {
    throw written.error;
  }
  getWorkspaceActorRef().send({
    type: "addMessage",
    value: {
      id: task.id,
      interrupt,
      message: message.value,
      model,
      saved: true,
      sessionId,
    },
  });
  await recordTaskActivity(task.id);
  return { message: message.value, running };
}
