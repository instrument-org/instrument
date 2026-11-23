/**
 * Scripts a page was still running when the wait for their command ended,
 * each kept under an id so a later command can wait for the same answer
 * instead of running the script a second time.
 */

/** What a command fails with when its script outlasted the wait in a page that still answers. */
export class ScriptStillRunningError extends Error {}

/** A script's answer from the guest's debugger, and when the script was sent. */
export interface RunningScript {
  answer: Promise<unknown>;
  id: string;
  startedAt: number;
}

/**
 * How long a finished script's answer is kept for a command to ask for. The
 * shell command asks again within a second of each wait ending, so this only
 * has to cover that gap.
 */
const ANSWER_KEPT_MS = 60_000;

/**
 * How many scripts are kept at once. One that never finishes is only let go
 * when a newer one takes its place.
 */
const MAX_RUNNING_SCRIPTS = 16;

const running = new Map<string, RunningScript>();

/** Keeps a script's pending answer, and returns the id a later command asks for it by. */
export function keepRunningScript(
  answer: Promise<unknown>,
  startedAt: number,
): RunningScript {
  const id = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const script = { answer, id, startedAt };
  running.set(id, script);
  for (const oldest of running.keys()) {
    if (running.size <= MAX_RUNNING_SCRIPTS) {
      break;
    }
    running.delete(oldest);
  }
  const forgetLater = () => {
    setTimeout(() => {
      running.delete(id);
    }, ANSWER_KEPT_MS).unref();
  };
  answer.then(forgetLater, forgetLater);
  return script;
}

/** The kept script with this id, while it runs and briefly after it finishes. */
export function runningScript(id: string): RunningScript | undefined {
  return running.get(id);
}

/** Lets go of a script whose answer has been delivered. */
export function forgetRunningScript(id: string) {
  running.delete(id);
}
