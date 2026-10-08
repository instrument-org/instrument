import { isWorking } from "./chat/activity";
import { folderReach } from "./chat/folder-reach";
import { expectStop } from "./chat/wake";
import { defaultTaskName } from "./default-task-name";
import { isToolPart } from "./is-tool-part";
import { chatTaskIds } from "./record-folders";
import { TASK_COMMAND } from "./shell-commands/task-command";
import {
  forkDirective,
  grantsOfChat,
  startFork,
} from "./shell-commands/task/fork";
import { chatModel } from "./shell-commands/task/model-choice";
import { Store } from "./store";
import { systemNote } from "./system-note";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { isTypedByUser } from "./typed-by-user";
import { getWorkspaceActorRef } from "./workspace-actor-ref";
import { wasCutShort } from "../machines/execute-tool-call";
import { type ChatId } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

/**
 * Fork on interrupt: when the user writes while the chat's turn is mid-work,
 * the turn is stopped, and then the harness, not the model, forks what the
 * turn had done so far to the background, where a copy of the agent carries
 * the work on. The chat answers the new message with the work still going.
 *
 * The fork starts from the turn's last finished step: every step whose
 * request completed and whose tool calls all came back. A step still running
 * when the message arrived is left out, its calls cut off partway, so the
 * fork starts from a message the provider has already seen (which is what
 * makes a fork cheap on a prompt cache) and decides that step again itself.
 */

/** The auto-fork each chat has, while it runs: one at a time per chat. */
const autoForks = new Map<ChatId, TaskId>();

/** A message that calls the work off rather than adding to it. */
const CALLS_IT_OFF =
  /^\W*(?:stop|cancel|abort|halt|never\s*mind|forget (?:it|that))\b/i;

export interface ForkedTurn {
  name: string;
  taskId: TaskId;
}

/**
 * A turn with work worth carrying on that was not forked, because the chat's
 * last auto-fork (`running`) still runs. Its finished steps stay in the
 * chat's history, and nothing else is doing them.
 */
export interface CutOffTurn {
  cutOff: true;
  running: TaskId;
}

/**
 * Whether a message the user sent mid-turn leaves the turn's work wanted. A
 * message that calls it off ends the turn the way any interruption did, with
 * nothing forked to stop again.
 */
export function keepsTheWork(message: SessionMessage.UserWithParts): boolean {
  return !CALLS_IT_OFF.test(textOf(message));
}

/**
 * What a fork of an interrupted turn inherits: the chat's messages up to the
 * turn's last finished step, or undefined when the turn did no tool work
 * worth carrying on (it was only writing, or it had nothing finished yet).
 *
 * The turn is everything after `turnMessageId`, the user's message it
 * answers. It is cut at the first message the chat had not finished when the
 * user wrote: a message in `exclude` (the ones that interrupted it), a reply
 * whose request was aborted or failed, or one with a call that was cut short
 * or never answered. What comes before is kept whole.
 */
export function interruptedTurnPrefix(
  messages: SessionMessage.WithParts[],
  {
    exclude,
    turnMessageId,
  }: { exclude: StoreId.Message[]; turnMessageId: StoreId.Message },
): SessionMessage.WithParts[] | undefined {
  const start = messages.findIndex((message) => message.id === turnMessageId);
  if (start === -1) {
    return undefined;
  }
  const turnStart = messages[start];
  if (turnStart?.role !== "user" || !isTypedByUser(turnStart)) {
    return undefined;
  }
  let end = start + 1;
  while (end < messages.length) {
    const message = messages[end];
    if (!message || exclude.includes(message.id) || !isFinished(message)) {
      break;
    }
    end += 1;
  }
  const kept = messages.slice(0, end);
  const lastReply = kept
    .slice(start + 1)
    .findLast((message) => message.role === "assistant");
  // A last step that called no tool was the turn's answer, and a turn with no
  // step finished has nothing to carry on that the chat would not redo.
  if (!lastReply?.parts.some((part) => isToolPart(part))) {
    return undefined;
  }
  return kept;
}

function isFinished(message: SessionMessage.WithParts): boolean {
  if (message.role !== "assistant") {
    return true;
  }
  const { error, finishedAt, finishReason } = message.metadata;
  return (
    finishedAt !== undefined &&
    error === undefined &&
    finishReason !== "aborted" &&
    finishReason !== "error" &&
    message.parts.every(
      (part) =>
        !isToolPart(part) ||
        (part.state.startsWith("output-") && !wasCutShort(part)),
    )
  );
}

/**
 * Forks an interrupted turn of a chat to the background, or does nothing
 * (undefined) when there is nothing to carry on. When the chat's last
 * auto-fork is still running, the interruption only ends the turn, and the
 * answer says so (`CutOffTurn`) so the agent can be told. Runs after the turn
 * has stopped, so what it reads is settled. A fork made as `signal` aborts
 * (the user stopped the chat meanwhile) is stopped at once.
 */
export async function forkInterruptedTurn({
  chatId,
  chatSessionId,
  exclude,
  signal,
  turnMessageId,
}: {
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  /** The messages that interrupted the turn, which the fork does not see. */
  exclude: StoreId.Message[];
  signal?: AbortSignal;
  /** The user's message the interrupted turn answers. */
  turnMessageId: StoreId.Message;
}): Promise<CutOffTurn | ForkedTurn | undefined> {
  const messages = await Store.getMessagesWithParts({
    sessionId: chatSessionId,
    taskId: chatId,
  });
  if (messages.isErr()) {
    throw messages.error;
  }
  if (signal?.aborted) {
    return undefined;
  }
  const prefix = interruptedTurnPrefix(messages.value, {
    exclude,
    turnMessageId,
  });
  const request = prefix?.find((message) => message.id === turnMessageId);
  if (!prefix || !request) {
    return undefined;
  }
  const running = autoForks.get(chatId);
  if (running && isWorking(running)) {
    return { cutOff: true, running };
  }
  const keepIds = new Set(prefix.map((message) => message.id));
  const { model, modelURI } = await chatModel("fork", {
    chatId,
    remainingYieldMs: () => 0,
    sessionId: chatSessionId,
  });
  const name = defaultTaskName(request);
  const taskId = await startFork({
    chatId,
    chatSessionId,
    folders: grantsOfChat(await folderReach(chatId)),
    idFrom: textOf(request) || name,
    keep: (all) => all.filter((message) => keepIds.has(message.id)),
    model,
    modelURI,
    name,
    prompt: forkDirective(CARRY_ON),
    settings: { forkedOnInterrupt: true },
  });
  autoForks.set(chatId, taskId);
  if (signal?.aborted) {
    stopFork(taskId);
    return undefined;
  }
  return { name, taskId };
}

/** The assignment an interrupted turn's fork is given. */
const CARRY_ON =
  "Carry on with the work this conversation was in the middle of when the user wrote again: the user's last request above is your assignment, from where your last finished step left it. A step that was under way then is not shown and may have stopped partway, so check what is already done (files written, changes made) before you redo anything. The chat is answering the user's newer message, which you do not see; finish this work.";

/**
 * Said to the chat beside the message that interrupted it, once its turn has
 * been forked: the work goes on, so this reply is for the message alone.
 */
export function interruptedNote({ name, taskId }: ForkedTurn): string {
  return systemNote`
    The user sent this while you were still working on their earlier request. That work was not dropped: it carries on in the background as task ${taskId} ("${name}"), a fork of you that picks up from your last finished step, and you will be told when it finishes. Do not redo it or wait on it; answer this message. If this message changes that work, \`${TASK_COMMAND.name} send ${taskId}\` passes the change on; if it calls the work off, \`${TASK_COMMAND.name} stop ${taskId}\`.
  `.trim();
}

/**
 * Said to the chat beside the message that interrupted it when the turn
 * could not be forked: the work stopped where it was, and nothing carries
 * it on.
 */
export function cutOffNote({ running }: CutOffTurn): string {
  return systemNote`
    The user sent this while you were still working on their earlier request. That work stopped where it was and nothing is carrying it on, since task ${running}, from an earlier interruption, is still running. Its finished steps are above. Answer this message; then pick that work up where it stopped, unless this message replaces it.
  `.trim();
}

/**
 * The chat's forks still running, for a stop of the chat to end with it: the
 * user's work may be running in one they never asked for (fork on
 * interrupt), and Stop means all of it.
 */
export async function runningForks(chatId: ChatId): Promise<TaskId[]> {
  const ids = chatTaskIds(chatId).filter((id) => isWorking(id));
  const settings = await Promise.all(
    ids.map((id) => getTaskSettings(taskDir(id))),
  );
  return ids.filter((_, index) => settings[index]?.fork === true);
}

/** Ends a fork's turn, as a stop the chat expects rather than news. */
export function stopFork(taskId: TaskId): void {
  expectStop(taskId);
  getWorkspaceActorRef().send({ type: "stopSessions", value: { id: taskId } });
}

function textOf(message: SessionMessage.WithParts): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}
