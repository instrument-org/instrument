import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

import { StoreId } from "../../schemas/store-id";

/**
 * A task the `task` command handed work to in a bash call: one it created
 * that is running, or one it sent a message that reaches it. Recorded where
 * it happens, so whoever reads the call's result knows what was handed off
 * without reading it back out of what the command printed for the model.
 *
 * A task created to wait on the user (the system's folder ask) or a message
 * queued behind a task that has not started is not one: the user, not the
 * task, has the next move.
 */
export const HandOffSchema = z.object({
  kind: z.enum(["created", "sent"]),
  /** The task, by its session in the chat's store. */
  sessionId: StoreId.SessionSchema,
});

export type HandOff = z.output<typeof HandOffSchema>;

const storage = new AsyncLocalStorage<HandOff[]>();

/** Runs a bash call with `handOffs` collecting what its `task` commands hand off. */
export function withHandOffs<T>(handOffs: HandOff[], run: () => T): T {
  return storage.run(handOffs, run);
}

export function recordHandOff(handOff: HandOff): void {
  storage.getStore()?.push(handOff);
}
