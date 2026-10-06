import { type ByteString } from "just-bash";

import { type SessionMessage } from "../../../schemas/session/message";
import { type Task } from "../../../schemas/task";
import { type TaskId } from "../../../schemas/task-id";
import { isWorking } from "../../chat/activity";
import { folderReach } from "../../chat/folder-reach";
import { latestOrNewSessionId } from "../../chat/latest-session";
import { mountAliases, toTaskPaths } from "../../chat/mount-paths";
import { folderLabel } from "../../folder-parent-label";
import { newMessage } from "../../new-message";
import { Store } from "../../store";
import { systemNote } from "../../system-note";
import { type TaskHold, queueBehindHold, taskHold } from "../../task-hold";
import { recordTaskActivity } from "../../task-settings";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { type PendingLook, resolveFileUploads } from "../task-args";
import { recordHandOff } from "../task-hand-off";
import { formatAge } from "../task-list-output";
import { subprocessStdin } from "../utils";
import { type TaskCommandContext } from "./context";
import { chatPathsOf, requireFoldersNamedInBriefHanded } from "./folders";
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
  files,
  interrupt = false,
  prompt,
  task,
}: {
  command: string;
  context: TaskCommandContext;
  files?: Awaited<ReturnType<typeof resolveFileUploads>>;
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
    ...(files ? { files } : {}),
    modelURI,
    prompt,
    sessionId,
    taskId: task.id,
  });
  if (message.isErr()) {
    throw message.error;
  }
  // A task held from starting hears this after its brief, once it starts. The
  // store gets it then too, so the transcript never shows it ahead of the brief.
  const held = taskHold(task.id);
  if (
    held &&
    queueBehindHold(task.id, () => {
      getWorkspaceActorRef().send({
        type: "addMessage",
        value: {
          agentName: "main",
          id: task.id,
          message: stampedNow(message.value),
          model,
          sessionId,
        },
      });
    })
  ) {
    await recordTaskActivity(task.id);
    return { held, message: message.value, running: false };
  }
  const running = isWorking(task.id);
  const written = await Store.saveMessageWithParts(message.value, task.id);
  if (written.isErr()) {
    throw written.error;
  }
  getWorkspaceActorRef().send({
    type: "addMessage",
    value: {
      agentName: "main",
      id: task.id,
      interrupt,
      message: message.value,
      model,
      saved: true,
      sessionId,
    },
  });
  await recordTaskActivity(task.id);
  return { held: undefined, message: message.value, running };
}

/** A hold as the conversation reads it: why, and for how long so far. */
export function describeHold(hold: TaskHold, now = Date.now()): string {
  return `${hold.reason} (${formatAge(now - hold.since.getTime())})`;
}

/**
 * What holds a task on the system's ask about its folders, in the
 * conversation's words and in the user's.
 */
export function folderAskHold(looks: PendingLook[]) {
  const names = looks.map((look) => folderLabel(look.path));
  return {
    reason: `macOS is asking the user about ${names.map((name) => `"${name}"`).join(" and ")}`,
    userReason: `Waiting for you to allow access to ${names.join(" and ")}`,
  };
}

/**
 * What the conversation said a folder or app is for, on stdin, in the task's
 * paths. Checked before the grant is written, so a message naming a folder the
 * task will not have refuses the whole call rather than half of it.
 */
export async function grantPurpose(
  command: "app" | "folder",
  taskId: TaskId,
  context: TaskCommandContext,
  stdin: ByteString,
  handed?: string[],
): Promise<string> {
  const said = promptFrom("", stdin);
  if (!said) {
    return "";
  }
  const chatFolders = await folderReach(context.chatId);
  requireFoldersNamedInBriefHanded(
    command,
    said,
    chatFolders,
    handed ?? chatPathsOf(mountAliases(chatFolders, await folderReach(taskId))),
    taskId,
  );
  // Translated against the folders as they stand once the grant is written,
  // which is when the task reads it; `tellOfGrant` does that.
  return said;
}

/**
 * The message as sent now: a message made before its task was held reaches
 * the task when the hold lets go, and the turn it starts is timed from there.
 */
export function stampedNow(
  message: SessionMessage.UserWithParts,
): SessionMessage.UserWithParts {
  return {
    ...message,
    metadata: { ...message.metadata, createdAt: new Date() },
  };
}

/**
 * Tells a task what a `folder` or `app` call changed, so the change takes
 * effect without a `send` after it: a working task hears it at its next step,
 * and an idle one it handed something carries on with it as a new turn. An
 * idle task that only lost something is left idle, since a turn to hear that
 * would cost money and do nothing; the change rides its next message anyway,
 * as the folder and app notes every message carries.
 */
export async function tellOfGrant({
  added,
  command,
  context,
  facts,
  purpose,
  task,
}: {
  added: boolean;
  command: "app" | "folder";
  context: TaskCommandContext;
  facts: string[];
  purpose: string;
  task: Task;
}): Promise<string> {
  const running = isWorking(task.id);
  if (!running && !added && !purpose) {
    return `${task.id} is not running; it is told when its next turn starts.\n`;
  }
  const said = purpose
    ? toTaskPaths(
        purpose,
        mountAliases(
          await folderReach(context.chatId),
          await folderReach(task.id),
        ),
      )
    : "";
  const { held } = await deliver({
    command,
    context,
    prompt: [facts.join(" "), said].filter(Boolean).join("\n\n"),
    task,
  });
  if (held) {
    return `${task.id} has not started (${describeHold(held)}); it is told this right after its brief once it starts.\n`;
  }
  recordHandOff({ kind: "sent", taskId: task.id });
  return running
    ? `Sent to ${task.id}, which is busy and hears this at its next step; you will be told when its turn finishes.\n`
    : `Sent to ${task.id}, which carries on with it now; you will be told when it finishes.\n`;
}

/**
 * The brief with what the user declined added to it: the task still starts,
 * so the refusal reaches the conversation the way any finish does, and it
 * does none of the work that needed the folder.
 */
export function withRefusals(
  message: SessionMessage.UserWithParts,
  refusals: string[],
): SessionMessage.UserWithParts {
  if (refusals.length === 0) {
    return message;
  }
  const note = systemNote`
    ${refusals.join("\n")}
    Do none of the work that needs that folder: say in one line that macOS refused it, and stop.
  `;
  // On the brief's own text, so the task reads it as part of what it was told.
  let noted = false;
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "text" || noted) {
        return part;
      }
      noted = true;
      return { ...part, text: `${part.text}\n${note}` };
    }),
  };
}
