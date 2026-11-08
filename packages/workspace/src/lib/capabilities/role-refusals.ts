import { type StoreId } from "../../schemas/store-id";

/**
 * The calls each session was refused for its role since its turn's end was
 * last read, by what the agent called (`choose`, `instrument task new`):
 * what the note waking a chat says of its task's turn beside the task's own
 * words, since a task that took a refusal for a fault has told its chat so.
 */
const refused = new Map<StoreId.Session, Set<string>>();

export function noteRoleRefusal(sessionId: StoreId.Session, called: string) {
  const calls = refused.get(sessionId) ?? new Set<string>();
  calls.add(called);
  refused.set(sessionId, calls);
}

/** The session's refused calls in the order first refused, cleared as they are read. */
export function takeRoleRefusals(sessionId: StoreId.Session): string[] {
  const calls = [...(refused.get(sessionId) ?? [])];
  refused.delete(sessionId);
  return calls;
}
