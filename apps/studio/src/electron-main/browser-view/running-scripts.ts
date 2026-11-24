/**
 * Scripts a page was still running when the wait for their command ended,
 * each kept under an id so a later command can wait for the same answer
 * instead of running the script a second time.
 */

/** What a command fails with when its script outlasted the wait in a page that still answers. */
export class ScriptStillRunningError extends Error {}

/** A script's answer from the guest's debugger, the tab it runs in, and when it was sent. */
export interface RunningScript {
  answer: Promise<unknown>;
  id: string;
  /** How many checks of whether its page still runs scripts went unanswered in a row. */
  missedChecks: number;
  startedAt: number;
  targetId: string;
}

/**
 * How long a finished script's answer is kept for a command to ask for. The
 * shell command asks again within a second of each wait ending, so this only
 * has to cover that gap.
 */
const ANSWER_KEPT_MS = 60_000;

/**
 * How many scripts are kept at once. Past that the one asked after longest
 * ago is let go, which is how one that never finishes goes.
 */
const MAX_RUNNING_SCRIPTS = 16;

const running = new Map<string, RunningScript>();

/** Keeps a script's pending answer, and returns the id a later command asks for it by. */
export function keepRunningScript({
  answer,
  startedAt,
  targetId,
}: Pick<RunningScript, "answer" | "startedAt" | "targetId">): RunningScript {
  const id = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const script = { answer, id, missedChecks: 0, startedAt, targetId };
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

/**
 * The script kept under this id for this tab, while it runs and briefly after
 * it finishes. Asking after one counts as its latest use.
 */
export function runningScript(
  id: string,
  targetId: string,
): RunningScript | undefined {
  const script = running.get(id);
  if (script?.targetId !== targetId) {
    return undefined;
  }
  running.delete(id);
  running.set(id, script);
  return script;
}

/** Lets go of a script whose answer has been delivered. */
export function forgetRunningScript(id: string) {
  running.delete(id);
}
