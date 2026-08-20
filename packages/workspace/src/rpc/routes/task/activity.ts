import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { isEqual } from "radashi";

import { ActiveReplays } from "../../../lib/active-replays";
import { getTaskAgentStatus } from "../../../lib/get-task-agent-status";
import { type WorkspaceActorRef } from "../../../machines/workspace";
import {
  type TaskActivity,
  TaskActivitySchema,
} from "../../../schemas/task-agent-status";
import { type TaskId } from "../../../schemas/task-id";
import { base } from "../../base";
import { publisher } from "../../publisher";

function getTaskActivity(workspaceRef: WorkspaceActorRef) {
  const activityByTaskId = new Map<TaskId, TaskActivity>();
  const { sessionRefsByTaskId } = workspaceRef.getSnapshot().context;

  for (const id of sessionRefsByTaskId.keys()) {
    const sessionActors = getTaskAgentStatus({
      id,
      workspaceRef,
    }).value.sessionActors.filter((sessionActor) =>
      sessionActor.tags.includes("agent.alive"),
    );

    if (sessionActors.length > 0) {
      activityByTaskId.set(id, {
        activeReplaySessionIds: [],
        sessionActors,
        taskId: id,
      });
    }
  }

  for (const { id, sessionId } of ActiveReplays.getActiveSessions()) {
    const activity = activityByTaskId.get(id);
    if (activity) {
      activity.activeReplaySessionIds.push(sessionId);
    } else {
      activityByTaskId.set(id, {
        activeReplaySessionIds: [sessionId],
        sessionActors: [],
        taskId: id,
      });
    }
  }

  return [...activityByTaskId.values()];
}

export const taskActivity = base
  .output(TaskActivitySchema.array())
  .handler(({ context }) => getTaskActivity(context.workspaceRef));

export const liveTaskActivity = base
  .output(eventIterator(TaskActivitySchema.array()))
  .handler(async function* ({ context, signal }) {
    let previousState = getTaskActivity(context.workspaceRef);
    yield previousState;

    const subscriptions = [
      publisher.subscribe("session.added", { signal }),
      publisher.subscribe("session.done", { signal }),
      publisher.subscribe("session.tagsChanged", { signal }),
      publisher.subscribe("replay.changed", { signal }),
    ] as const;

    for await (const _payload of mergeGenerators(subscriptions)) {
      const currentState = getTaskActivity(context.workspaceRef);
      if (!isEqual(currentState, previousState)) {
        previousState = currentState;
        yield currentState;
      }
    }
  });
