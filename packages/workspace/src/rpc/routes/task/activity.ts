import { liveRead } from "../../live-read";
import { eventIterator } from "@orpc/server";
import { isEqual } from "radashi";

import { getTaskAgentStatus } from "../../../lib/get-task-agent-status";
import { type WorkspaceActorRef } from "../../../machines/workspace";
import {
  type TaskAgentStatus,
  TaskAgentStatusSchema,
} from "../../../schemas/task-agent-status";
import { base } from "../../base";
import { publisher } from "../../publisher";

function getTaskActivity(workspaceRef: WorkspaceActorRef) {
  const activity: TaskAgentStatus[] = [];
  const { sessionRefsByTaskId } = workspaceRef.getSnapshot().context;

  for (const id of sessionRefsByTaskId.keys()) {
    const sessionActors = getTaskAgentStatus({
      id,
      workspaceRef,
    }).value.sessionActors.filter((sessionActor) =>
      sessionActor.tags.includes("agent.alive"),
    );

    if (sessionActors.length > 0) {
      activity.push({ sessionActors, taskId: id });
    }
  }

  return activity;
}

export const liveTaskActivity = base
  .output(eventIterator(TaskAgentStatusSchema.array()))
  .handler(async function* ({ context, signal }) {
    let previousState: TaskAgentStatus[] | undefined;
    for await (const currentState of liveRead({
      changes: [
        publisher.subscribe("session.added", { signal }),
        publisher.subscribe("session.done", { signal }),
        publisher.subscribe("session.tagsChanged", { signal }),
      ],
      read: () => getTaskActivity(context.workspaceRef),
    })) {
      if (
        previousState === undefined ||
        !isEqual(currentState, previousState)
      ) {
        previousState = currentState;
        yield currentState;
      }
    }
  });
