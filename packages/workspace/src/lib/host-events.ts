import { publisher } from "../rpc/publisher";
import { subscribeApps } from "./apps/store";

/**
 * What the host app hears from the workspace, without reaching its event
 * bus. The bus stays the workspace's own, so the workspace can move out of
 * the host's process with these as the only calls that cross; what the host
 * tells the workspace goes through calls of the workspace's own
 * (`appChanged`).
 */

/** The subscription to the apps store that says its changes, and how many listen to it. */
let storeChanges: { listening: number; stop: Promise<() => void> } | undefined;

/**
 * Says each change to the apps store, made here or arriving from another
 * device, as one app change, however many listen: every listener hears the
 * bus, so a subscription each would say one change once per listener.
 * Returns the stop, which may be called more than once.
 */
function sayAppStoreChanges(): () => void {
  storeChanges ??= {
    listening: 0,
    stop: subscribeApps(() => {
      publisher.publish("app.updated", null);
    }).catch(() => () => undefined),
  };
  const held = storeChanges;
  held.listening += 1;
  let isStopped = false;
  return () => {
    if (isStopped) {
      return;
    }
    isStopped = true;
    held.listening -= 1;
    if (held.listening === 0) {
      void held.stop.then((stop) => {
        stop();
      });
      if (storeChanges === held) {
        storeChanges = undefined;
      }
    }
  };
}

/**
 * Fires each time the workspace's apps change, until `signal` aborts: what
 * the app did to one, and while anyone listens, any change to the apps store,
 * made here or on another device. Subscribed as it is called, as `liveRead`
 * needs.
 */
export function appListChanges(signal: AbortSignal | undefined) {
  const changes = publisher.subscribe("app.updated", { signal });
  const stop = sayAppStoreChanges();
  signal?.addEventListener("abort", stop, { once: true });
  return (async function* () {
    try {
      yield* changes;
    } finally {
      stop();
    }
  })();
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
