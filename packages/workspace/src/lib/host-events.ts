import { publisher } from "../rpc/publisher";
import { watchFolder } from "./folder-watch";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What the host app hears from the workspace, without reaching its event
 * bus. The bus stays the workspace's own, so the workspace can move out of
 * the host's process with these as the only calls that cross; what the host
 * tells the workspace goes through calls of the workspace's own
 * (`appChanged`).
 */

/** The watch on each apps folder that says its edits, and how many listen to it. */
const appsFolderWatches = new Map<
  string,
  { listening: number; stop: () => void }
>();

/**
 * Says each edit to the apps folder as one app change, however many listen:
 * every listener hears the bus, so a watch each would say one edit once per
 * listener. Returns the stop, which may be called more than once.
 */
function sayAppsFolderEdits(dir: string): () => void {
  let watch = appsFolderWatches.get(dir);
  if (!watch) {
    watch = {
      listening: 0,
      stop: watchFolder(dir, {
        depth: 1,
        onChange: () => {
          publisher.publish("app.updated", null);
        },
      }),
    };
    appsFolderWatches.set(dir, watch);
  }
  const held = watch;
  held.listening += 1;
  let isStopped = false;
  return () => {
    if (isStopped) {
      return;
    }
    isStopped = true;
    held.listening -= 1;
    if (held.listening === 0) {
      held.stop();
      if (appsFolderWatches.get(dir) === held) {
        appsFolderWatches.delete(dir);
      }
    }
  };
}

/**
 * Fires each time the workspace's apps change, until `signal` aborts: what
 * the app did to one, and while anyone listens, any edit to the apps folder
 * on disk, by the agent, the person, or another program. Subscribed as it
 * is called, as `liveRead` needs.
 */
export function appListChanges(signal: AbortSignal | undefined) {
  const changes = publisher.subscribe("app.updated", { signal });
  const stop = sayAppsFolderEdits(getWorkspaceConfig().appsDir);
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
