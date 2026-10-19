import { z } from "zod";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { listBackgroundProcesses } from "../background-processes";
import { ChatReads } from "../chat-reads";
import { getChatAgentStatus } from "../get-chat-agent-status";
import { sessionOfChat } from "../record-folders";
import { writingChatRecords } from "../records/chat-records";
import { liveView } from "../records/views";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { listChildTasks } from "./children";
import { latestStepIn } from "./step-label";
import { type LeftRunning } from "./left-running";
import { type ChatId } from "../../schemas/chat-id";

const RunningTaskSchema = z.object({
  /** What the task is doing this moment, in its agent's own label, when it gave one. */
  step: z.string().optional(),
  /** The task's session in the chat's store, which is its id. */
  sessionId: StoreId.SessionSchema,
  /** The chat it was filed from, by session id; absent for a task filed outside a turn. */
  chat: z.string().optional(),
  title: z.string(),
  /** When something last happened in it, in ms. */
  updatedAt: z.number(),
});

export const ChatActivitySchema = z.object({
  running: RunningTaskSchema.array(),
});
export type ChatActivity = z.output<typeof ChatActivitySchema>;

/** A session, in the store of the record that holds it. */
export interface SessionRef {
  sessionId: StoreId.Session;
  chatId: ChatId;
}

/**
 * Whether an agent of the record is alive: of the one session named, or of
 * any of its sessions, a chat's tasks included.
 */
export function isWorking(chatId: ChatId, sessionId?: StoreId.Session) {
  const status = getChatAgentStatus({
    id: chatId,
    workspaceRef: getWorkspaceActorRef(),
  });
  return (
    status.isOk() &&
    status.value.sessionActors.some(
      (actor) =>
        (sessionId === undefined || actor.sessionId === sessionId) &&
        actor.tags.includes("agent.alive"),
    )
  );
}

/**
 * A session's own messages, without what a task carries on from its chat,
 * the parts its running turn holds over them included; empty when the read
 * fails.
 */
export async function ownMessages(
  ref: SessionRef,
): Promise<SessionMessage.WithParts[]> {
  const messages = await ChatReads.transcript({ ...ref, inherited: false });
  return messages.isOk() ? messages.value : [];
}

/**
 * What a session's running turn holds in memory, which nothing has written:
 * the reply streaming in, and the calls whose input is still arriving.
 * Empty where this process writes no records, or the chat has none.
 */
export async function liveMessages(
  ref: SessionRef,
): Promise<SessionMessage.WithParts[]> {
  const records = writingChatRecords();
  if (!records) {
    return [];
  }
  try {
    return liveView(await records.read(ref.chatId), ref.sessionId);
  } catch {
    return [];
  }
}

/**
 * The label on the newest tool call of a session's own, the turn's own
 * memory included, where a call still being typed is.
 */
export async function latestStep(ref: SessionRef): Promise<string | undefined> {
  return latestStepIn(await ownMessages(ref));
}

/**
 * What a task has running in the background right now, oldest first. A
 * different fact from `isWorking`, and the two come apart exactly when it
 * matters: a task whose turn ended with a scan still going is idle and has
 * this.
 */
export function leftRunning(
  sessionId: StoreId.Session,
  now = Date.now(),
): LeftRunning[] {
  return listBackgroundProcesses(sessionId)
    .filter((process) => process.status === "running")
    .map((process) => ({
      command: process.command,
      id: process.id,
      runningForMs: Math.max(0, now - process.startedAt.getTime()),
    }));
}

/**
 * What is happening behind the conversation right now: each task of the
 * chat's that is at work, and the label on its latest step. The
 * conversation shows this under its transcript, so a reply that handed the
 * work off does not read as the end of it.
 */
export async function chatActivity(chatId: ChatId): Promise<ChatActivity> {
  const children = await listChildTasks(chatId, (id) => isWorking(chatId, id));
  const running = await Promise.all(
    children.map(async (child) => {
      const chat = sessionOfChat(child.chatId);
      const step = await latestStep({ sessionId: child.id, chatId });
      return {
        ...(step ? { step } : {}),
        sessionId: child.id,
        ...(chat ? { chat } : {}),
        title: child.title,
        updatedAt: child.updatedAt.getTime(),
      };
    }),
  );
  return { running };
}

/**
 * When a task's current turn began: the moment the last message reached
 * it. Wall-clock, because a task can spend minutes inside one model reply,
 * which no tool timing counts.
 */
export async function turnStartedAt(
  ref: SessionRef,
): Promise<Date | undefined> {
  return (await ownMessages(ref)).findLast((message) => message.role === "user")
    ?.metadata.createdAt;
}
