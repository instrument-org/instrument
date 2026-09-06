import { z } from "zod";

import { type TaskId } from "../../schemas/task-id";
import { getTaskAgentStatus } from "../get-task-agent-status";
import { isToolPart } from "../is-tool-part";
import { Store } from "../store";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { listChildTasks } from "./children";
import { latestSessionId } from "./latest-session";

const RunningTaskSchema = z.object({
  /** What the task is doing this moment, in its agent's own label, when it gave one. */
  step: z.string().optional(),
  taskId: z.string(),
  title: z.string(),
});

export const OrchestratorActivitySchema = z.object({
  running: RunningTaskSchema.array(),
});
export type OrchestratorActivity = z.output<typeof OrchestratorActivitySchema>;

/** How much of a step's label the conversation shows. */
const STEP_MAX_LENGTH = 80;

export function isWorking(taskId: TaskId) {
  const status = getTaskAgentStatus({
    id: taskId,
    workspaceRef: getWorkspaceActorRef(),
  });
  return (
    status.isOk() &&
    status.value.sessionActors.some((actor) =>
      actor.tags.includes("agent.alive"),
    )
  );
}

export async function latestStep(taskId: TaskId): Promise<string | undefined> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return undefined;
  }
  const messages = await Store.getMessagesWithParts({
    sessionId: sessionId.value,
    taskId,
  });
  if (messages.isErr()) {
    return undefined;
  }
  for (const message of messages.value.toReversed()) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts.toReversed()) {
      if (!isToolPart(part)) {
        continue;
      }
      const input: unknown = part.input;
      const label =
        typeof input === "object" && input !== null
          ? "title" in input && typeof input.title === "string"
            ? input.title
            : "explanation" in input && typeof input.explanation === "string"
              ? input.explanation
              : undefined
          : undefined;
      if (label?.trim()) {
        return label.length > STEP_MAX_LENGTH
          ? `${label.slice(0, STEP_MAX_LENGTH)}…`
          : label;
      }
    }
  }
  return undefined;
}

/**
 * What is happening behind the conversation right now: each task of the
 * orchestrator's that is at work, and the label on its latest step. The
 * conversation shows this under its transcript, so a reply that handed the
 * work off does not read as the end of it.
 */
export async function orchestratorActivity(
  orchestratorTaskId: TaskId,
): Promise<OrchestratorActivity> {
  const children = await listChildTasks(orchestratorTaskId);
  const running = await Promise.all(
    children
      .filter((child) => isWorking(child.id))
      .map(async (child) => ({
        step: await latestStep(child.id),
        taskId: child.id,
        title: child.title,
      })),
  );
  return { running };
}

/**
 * When the task's current turn began: the moment the last message reached
 * it. Wall-clock, because a task can spend minutes inside one model reply,
 * which no tool timing counts.
 */
export async function turnStartedAt(taskId: TaskId): Promise<Date | undefined> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return undefined;
  }
  const messages = await Store.getMessagesWithParts({
    sessionId: sessionId.value,
    taskId,
  });
  if (messages.isErr()) {
    return undefined;
  }
  return messages.value.findLast((message) => message.role === "user")?.metadata
    .createdAt;
}
