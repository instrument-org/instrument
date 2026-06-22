import { call, eventIterator } from "@orpc/server";
import { isEqual } from "radashi";
import { ulid } from "ulid";
import { z } from "zod";

import { redactWorkspacePaths } from "../../lib/redact-workspace-paths";
import { RuntimeLogEntrySchema } from "../../machines/runtime";
import { TaskIdSchema } from "../../schemas/task-id";
import { base } from "../base";
import { publisher } from "../publisher";

const restart = base
  .input(
    z.object({
      taskId: TaskIdSchema,
    }),
  )
  .handler(({ context, input }) => {
    context.workspaceRef.send({
      type: "restartRuntime",
      value: {
        id: input.taskId,
      },
    });
  });

const clearLogs = base
  .input(
    z.object({
      taskId: TaskIdSchema,
    }),
  )
  .handler(({ context, input }) => {
    const snapshot = context.workspaceRef.getSnapshot();
    const runtimeRef = snapshot.context.runtimeRefs.get(input.taskId);

    if (runtimeRef) {
      runtimeRef.send({ type: "clearLogs" });
    }
  });

const RuntimeLogEntrySchemaWithTruncation = RuntimeLogEntrySchema.extend({
  type: z.enum(["error", "normal", "truncation"]),
});

const logList = base
  .input(
    z.object({
      id: TaskIdSchema,
      limit: z.number().optional().default(1000),
    }),
  )
  .output(RuntimeLogEntrySchemaWithTruncation.array())
  .handler(({ context, input }) => {
    const snapshot = context.workspaceRef.getSnapshot();
    const runtimeRef = snapshot.context.runtimeRefs.get(input.id);

    if (!runtimeRef) {
      return [];
    }

    const runtimeSnapshot = runtimeRef.getSnapshot();
    const allLogs = runtimeSnapshot.context.logs;

    let logsToReturn;
    if (allLogs.length <= input.limit) {
      logsToReturn = allLogs;
    } else {
      const truncatedCount = allLogs.length - input.limit;
      const recentLogs = allLogs.slice(-input.limit);

      const truncationMessage = {
        createdAt: new Date(),
        id: ulid(),
        message: `... ${truncatedCount} earlier log entries truncated`,
        type: "truncation" as const,
      };

      logsToReturn = [truncationMessage, ...recentLogs];
    }

    const taskId = input.id;

    return logsToReturn.map((log) => ({
      ...log,
      message: redactWorkspacePaths(log.message, taskId),
    }));
  });

const logLiveList = base
  .input(
    z.object({
      id: TaskIdSchema,
      limit: z.number().optional().default(1000),
    }),
  )
  .output(eventIterator(RuntimeLogEntrySchemaWithTruncation.array()))
  .handler(async function* ({ context, input, signal }) {
    let previousLogs = yield call(logList, input, { context, signal });

    for await (const payload of publisher.subscribe("runtime.log.updated", {
      signal,
    })) {
      if (payload.id === input.id) {
        const currentLogs = yield call(logList, input, { context, signal });

        if (!isEqual(currentLogs, previousLogs)) {
          previousLogs = currentLogs;
        }
      }
    }
  });

export const runtime = {
  clearLogs,
  log: {
    list: logList,
    live: {
      list: logLiveList,
    },
  },
  restart,
};
