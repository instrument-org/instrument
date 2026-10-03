import { mergeGenerators } from "@instrument-org/shared/merge-generators";
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
    let previousState = getTaskActivity(context.workspaceRef);
    yield previousState;

    const subscriptions = [
      publisher.subscribe("session.added", { signal }),
      publisher.subscribe("session.done", { signal }),
      publisher.subscribe("session.tagsChanged", { signal }),
    ] as const;

    for await (const _payload of mergeGenerators(subscriptions)) {
      const currentState = getTaskActivity(context.workspaceRef);
      if (!isEqual(currentState, previousState)) {
        previousState = currentState;
        yield currentState;
      }
    }
  });
