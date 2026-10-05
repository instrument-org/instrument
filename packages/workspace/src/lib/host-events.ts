import { publisher } from "../rpc/publisher";

/**
 * What the host app hears from the workspace, without reaching its event
 * bus. The bus stays the workspace's own, so the workspace can move out of
 * the host's process with these as the only calls that cross; what the host
 * tells the workspace goes through calls of the workspace's own
 * (`appChanged`).
 */

/** Fires each time the workspace's apps change, until `signal` aborts. */
export function appListChanges(signal: AbortSignal | undefined) {
  return publisher.subscribe("app.updated", { signal });
}

/**
 * Each session whose agent finished, until `signal` aborts. `maxBuffered`
 * is how many a listener still busy with one keeps of those after it.
 */
export function sessionEnds({
  maxBuffered,
  signal,
}: {
  maxBuffered?: number;
  signal?: AbortSignal;
} = {}) {
  return publisher.subscribe("session.done", {
    ...(maxBuffered === undefined ? {} : { maxBufferedEvents: maxBuffered }),
    signal,
  });
}
