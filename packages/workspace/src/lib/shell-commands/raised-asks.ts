import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string[]>();

/**
 * Runs a bash call with `asks` collecting the cards its commands raise for
 * the person to answer, by their ids: the call's result says so, and the
 * turn ends on it, as it does on `ask_permission`, since the card says why.
 */
export function withRaisedAsks<T>(asks: string[], run: () => T): T {
  return storage.run(asks, run);
}

export function recordRaisedAsk(askId: string): void {
  storage.getStore()?.push(askId);
}
