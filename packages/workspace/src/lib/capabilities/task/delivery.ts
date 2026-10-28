import { ChatWrites } from "../../chat-writes";
import { isWorking } from "../../chat/activity";
import { type ChatTask, touchTask } from "../../chat/children";
import { newMessage } from "../../new-message";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { type ChatId } from "../../../schemas/chat-id";
import { chatModel } from "./model-choice";

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
  context: { chatId: ChatId };
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
  const written = await ChatWrites.saveMessageWithParts(
    message.value,
    task.chatId,
  );
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
  await touchTask(task.chatId, sessionId);
  return { message: message.value, running };
}
