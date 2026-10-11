import { type ByteString } from "just-bash";

import { isWorking } from "../../chat/activity";
import { type ChatTask, touchTask } from "../../chat/children";
import { newMessage } from "../../new-message";
import { Store } from "../../store";
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
 * Puts the chat's message into a task, as words from the chat rather than
 * from the user: saved at once, so the task's transcript shows it
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
  task: ChatTask;
}) {
  const { model, modelURI } = await chatModel(command, context);
  const sessionId = task.id;
  const message = await newMessage({
    fromChat: { kind: "message", text: prompt },
    modelURI,
    prompt: "",
    sessionId,
    chatId: task.chatId,
  });
  if (message.isErr()) {
    throw message.error;
  }
  const running = isWorking(task.chatId, sessionId);
  const written = await Store.saveMessageWithParts(message.value, task.chatId);
  if (written.isErr()) {
    throw written.error;
  }
  getWorkspaceActorRef().send({
    type: "addMessage",
    value: {
      id: task.chatId,
      interrupt,
      message: message.value,
      model,
      saved: true,
      sessionId,
    },
  });
  await touchTask(task.chatId, sessionId, { status: "running" });
  return { message: message.value, running };
}
