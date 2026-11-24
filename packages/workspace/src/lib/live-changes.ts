import { type LiveEvent, publisher } from "../rpc/publisher";
import { subscribeApps } from "./apps/store";
import { projectsDir } from "./chat/projects";
import { watchProjectRecords } from "./chat/project-records";
import { watchFolder } from "./folder-watch";
import { watchMemoryRecords } from "./memory/memory-records";
import { memoryDir } from "./memory/store";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Where each list the workspace shows is read from on disk, so a change made
 * there by anyone (the app, the agent, the person in their files, another
 * device) is said as that list's event. A list kept in both a folder and a
 * synced store names both.
 */
const SOURCES = {
  "app.updated": (say) => [untilStopped(subscribeApps(say))],
  "memory.changed": (say) => [
    watchFolder(memoryDir(), { depth: 0, onChange: say }),
    watchMemoryRecords(memoryDir(), say),
  ],
  "project.changed": (say) => [
    watchFolder(projectsDir(), { depth: 1, onChange: say }),
    watchProjectRecords(getWorkspaceConfig().rootDir, say),
  ],
  // Each skill's folder is watched, so a `SKILL.md` saved is heard at once;
  // deeper files are found by the folder's regular read.
  "skill.changed": (say) => [
    watchFolder(getWorkspaceSkillsDir(), { depth: 1, onChange: say }),
  ],
} satisfies Record<LiveEvent, (say: () => void) => (() => void)[]>;

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
    stops: SOURCES[event](() => {
      publisher.publish(event, null);
    }),
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
