import { type ChildTask } from "@instrument-org/workspace/client";

/**
 * Who stopped a finished task, in the words its own page ends on; none for
 * one that ended on its own. The app's closing is not here: that reads as a
 * failure, with its own line.
 */
export function taskStoppedLine(stoppedBy: ChildTask["stoppedBy"]) {
  switch (stoppedBy) {
    case "person": {
      return "You stopped this task";
    }
    case "agent": {
      return "The chat stopped this task";
    }
    default: {
      return undefined;
    }
  }
}
