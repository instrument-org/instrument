import { type WorkspaceActorRef } from "../machines/workspace";

export function countAliveAgentSessions(workspaceRef: WorkspaceActorRef) {
  const { sessionRefsBySubdomain } = workspaceRef.getSnapshot().context;
  let count = 0;

  for (const sessionRefs of sessionRefsBySubdomain.values()) {
    for (const sessionRef of sessionRefs) {
      if (sessionRef.getSnapshot().hasTag("agent.alive")) {
        count += 1;
      }
    }
  }

  return count;
}

export function hasAliveAgentSessions(workspaceRef: WorkspaceActorRef) {
  return countAliveAgentSessions(workspaceRef) > 0;
}
