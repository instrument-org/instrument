import { publisher } from "../rpc/publisher";
import { changesTo } from "./live-changes";

/**
 * What the host app hears from the workspace, without reaching its event
 * bus. The bus stays the workspace's own, so the workspace can move out of
 * the host's process with these as the only calls that cross; what the host
 * tells the workspace goes through calls of the workspace's own
 * (`appChanged`).
 */

/**
 * Fires each time the workspace's apps change, until `signal` aborts: what
 * the app did to one, and while anyone listens, any change to the apps store,
 * made here or on another device. Subscribed as it is called, as `liveRead`
 * needs.
 */
export function appListChanges(signal: AbortSignal | undefined) {
  return changesTo("app.updated", signal);
}

/** Fires each time the app directory changes, until `signal` aborts. */
export function appCatalogChanges(signal: AbortSignal | undefined) {
  return publisher.subscribe("app.catalogChanged", { signal });
}

/**
 * Each chat that came to rest (`chat.settled`), until `signal` aborts.
 * `maxBuffered` is how many a listener still busy with one keeps of those
 * after it.
 */
export function chatSettles({
  maxBuffered,
  signal,
}: {
  maxBuffered?: number;
  signal?: AbortSignal;
} = {}) {
  return publisher.subscribe("chat.settled", {
    ...(maxBuffered === undefined ? {} : { maxBufferedEvents: maxBuffered }),
    signal,
  });
}

/**
 * Each session whose turn ended (`session.done`), with whose stop ended it,
 * until `signal` aborts.
 */
export function turnEnds(signal?: AbortSignal) {
  return publisher.subscribe("session.done", { signal });
}

/** Each chat marked read on this computer, until `signal` aborts. */
export function chatReads(signal?: AbortSignal) {
  return publisher.subscribe("chat.read", { signal });
}
