import { type LiveEvent, publisher } from "../rpc/publisher";
import { projectsDir } from "./chat/projects";
import { watchFolder } from "./folder-watch";
import { memoryDir } from "./memory/store";
import { SYNCED_DOMAINS, type SyncedDomain } from "./synced-store/domains";
import { heldStore } from "./synced-store/held-stores";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * The folders of the person's each list is read from. A list kept in a synced
 * store is read from that too, by the store's own entry in `SYNCED_DOMAINS`.
 */
const FOLDERS: Record<LiveEvent, (say: () => void) => (() => void)[]> = {
  "app.updated": () => [],
  "memory.changed": (say) => [
    watchFolder(memoryDir(), { depth: 0, onChange: say }),
  ],
  "project.changed": (say) => [
    watchFolder(projectsDir(), { depth: 1, onChange: say }),
  ],
  // Each skill's folder is watched, so a `SKILL.md` saved is heard at once;
  // deeper files are found by the folder's regular read.
  "skill.changed": (say) => [
    watchFolder(getWorkspaceSkillsDir(), { depth: 1, onChange: say }),
  ],
};

/**
 * Follows everything a list is read from, so a change made there by anyone
 * (the app, the agent, the person in their files, another device) is said as
 * the list's event.
 */
function follow(event: LiveEvent): (() => void)[] {
  const say = () => {
    publisher.publish(event, null);
  };
  const stores = Object.entries(SYNCED_DOMAINS).flatMap(([domain, how]) =>
    "event" in how && how.event === event
      ? // Object.entries widens the keys of a const object to string.
        [untilStopped(subscribeStore(domain as SyncedDomain, say))]
      : [],
  );
  return [...FOLDERS[event](say), ...stores];
}

async function subscribeStore(
  domain: SyncedDomain,
  say: () => void,
): Promise<() => void> {
  return (await heldStore(domain)).subscribe(say);
}

/** The sources being watched, by event, and how many listen. */
const watched = new Map<
  LiveEvent,
  { listening: number; stops: (() => void)[] }
>();

/**
 * Fires on each `event` until `signal` aborts: what the app says of it, and
 * any change to what the list is read from. The sources are watched only
 * while something listens, once however many do, so a change is said once
 * rather than once per listener. Subscribed as it is called, as `liveRead`
 * needs.
 */
export function changesTo(event: LiveEvent, signal: AbortSignal | undefined) {
  const changes = publisher.subscribe(event, { signal });
  const stop = watchSources(event);
  if (signal?.aborted) {
    stop();
  } else {
    signal?.addEventListener("abort", stop, { once: true });
  }
  return (async function* () {
    try {
      yield* changes;
    } finally {
      stop();
    }
  })();
}

/** Returns the stop, which may be called more than once. */
function watchSources(event: LiveEvent): () => void {
  const held = watched.get(event) ?? {
    listening: 0,
    stops: follow(event),
  };
  watched.set(event, held);
  held.listening += 1;
  let isStopped = false;
  return () => {
    if (isStopped) {
      return;
    }
    isStopped = true;
    held.listening -= 1;
    if (held.listening === 0) {
      watched.delete(event);
      for (const stop of held.stops) {
        stop();
      }
    }
  };
}

/** A stop for a subscription still being made; one that failed has nothing to stop. */
function untilStopped(subscribing: Promise<() => void>): () => void {
  const made = subscribing.catch(() => () => undefined);
  return () => {
    void made.then((stop) => {
      stop();
    });
  };
}
