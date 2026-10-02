/**
 * Whether a task has an agent at work, read off the status the workspace
 * reports for it: every non-final state of a session carries `agent.alive`,
 * and a task whose turn is over reports no sessions at all.
 */
export function hasLiveAgent(status: {
  sessionActors: { tags: string[] }[];
}): boolean {
  return status.sessionActors.some((actor) =>
    actor.tags.includes("agent.alive"),
  );
}
