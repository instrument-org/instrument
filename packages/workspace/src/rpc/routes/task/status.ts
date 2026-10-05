import { eventIterator } from "@orpc/server";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { isWorking, latestStep } from "../../../lib/chat/activity";
import { latestSessionId } from "../../../lib/chat/latest-session";
import { type TypedError } from "../../../lib/errors";
import { getTask } from "../../../lib/get-tasks";
import { recordChanges } from "../../../lib/record-changes";
import { taskHold } from "../../../lib/task-hold";
import { StoreId } from "../../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { distinct, liveRead } from "../../live-read";

/** Where one task stands this moment: what a card, a page header, or a transcript following it reads. */
const TaskStatusSchema = z.object({
  /** Why it has not started yet, in the user's words, while it is held. */
  held: z.string().optional(),
  /** Whether one of its agents is alive. */
  isWorking: z.boolean(),
  /** The session it talks in: its newest top-level one, none before it has one. */
  newestSessionId: StoreId.SessionSchema.optional(),
  /** The label on its newest tool call, while it works. */
  step: z.string().optional(),
  title: z.string(),
  updatedAt: z.number(),
});

type TaskStatus = z.output<typeof TaskStatusSchema>;

async function readStatus(
  id: TaskId,
): Promise<Result<TaskStatus, TypedError.Type>> {
  const task = await getTask(id);
  if (task.isErr()) {
    return err(task.error);
  }
  const working = isWorking(id);
  const held = taskHold(id);
  const [step, newest] = await Promise.all([
    working ? latestStep(id) : undefined,
    latestSessionId(id),
  ]);
  const newestSessionId = newest.isOk() ? newest.value : undefined;
  return ok({
    ...(held ? { held: held.userReason } : {}),
    isWorking: working,
    ...(newestSessionId ? { newestSessionId } : {}),
    ...(step ? { step } : {}),
    title: task.value.title,
    updatedAt: task.value.updatedAt.getTime(),
  });
}

const status = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskStatusSchema)
  .handler(async ({ errors, input }) => {
    const read = await readStatus(input.id);
    if (read.isErr()) {
      throw toORPCError(read.error, errors);
    }
    return read.value;
  });

/**
 * The same, again whenever anything about the task moves: its agent, a hold,
 * its transcript (the step), its sessions, its settings (the title). An
 * answer the same as the last is not sent, so a reply streaming in sends
 * nothing until the step changes.
 */
const liveStatus = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(TaskStatusSchema))
  .handler(async function* ({ errors, input, signal }) {
    yield* distinct(
      liveRead({
        changes: [recordChanges(signal, (change) => change.id === input.id)],
        read: async () => {
          const read = await readStatus(input.id);
          if (read.isErr()) {
            throw toORPCError(read.error, errors);
          }
          return read.value;
        },
      }),
    );
  });

export const taskStatus = { live: liveStatus, status };
