import ms from "ms";

/**
 * Looking again for what a watch missed: whatever another device can change
 * behind the app's back is looked at when one of its windows comes forward
 * and every so often while one is in front, so a missed change is late
 * rather than lost. One rule for the chats' records and every synced store.
 */

const LOOK_MS = ms("1 minute");

let inFront = false;

interface Looking {
  everyMs: number;
  look: () => void;
  timer?: NodeJS.Timeout;
}

const lookers = new Set<Looking>();

function lookNow(looking: Looking): void {
  clearInterval(looking.timer);
  looking.look();
  looking.timer = setInterval(looking.look, looking.everyMs);
  looking.timer.unref();
}

/** Said by the host as a window of the app comes forward, and as the last goes behind. */
export function setWorkspaceInFront(front: boolean): void {
  inFront = front;
  for (const looking of lookers) {
    if (front) {
      lookNow(looking);
    } else {
      clearInterval(looking.timer);
    }
  }
}

/**
 * Looks each time a window comes forward and every `everyMs` while one is in
 * front, starting now if one is. Answers the stop.
 */
export function lookWhileInFront(
  look: () => void,
  everyMs = LOOK_MS,
): () => void {
  const looking: Looking = { everyMs, look };
  lookers.add(looking);
  if (inFront) {
    lookNow(looking);
  }
  return () => {
    lookers.delete(looking);
    clearInterval(looking.timer);
  };
}
