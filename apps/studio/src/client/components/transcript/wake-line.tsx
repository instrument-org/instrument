import { type Turn } from "@instrument-org/workspace/client";

type WokenBy = NonNullable<Turn["wokenBy"]>;

function wordsFor(woken: WokenBy): string {
  switch (woken.kind) {
    case "signed-in": {
      return "After you signed in";
    }
    case "task-checked-on": {
      return woken.count === 1
        ? "While the task kept working"
        : "While the tasks kept working";
    }
    case "task-failed": {
      return woken.count === 1
        ? "When the task ran into a problem"
        : "When a task ran into a problem";
    }
    case "task-finished": {
      return woken.count === 1
        ? "When the task finished"
        : "When the tasks finished";
    }
  }
}

/**
 * The quiet line at the head of work a wake carried on, below the answer it
 * follows, saying why the agent picked up again.
 */
export function WakeLine({ woken }: { woken: WokenBy }) {
  return <p className="text-xs text-muted-foreground">{wordsFor(woken)}</p>;
}
