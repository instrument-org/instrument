import {
  getToolNameByType,
  isInteractiveTool,
  isToolPart,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

export function hasTerminalToolState(part: SessionMessagePart.ToolPart) {
  return part.state === "output-available" || part.state === "output-error";
}

/**
 * Whether a call is waiting on the user rather than on the runtime: an
 * interactive tool that has its input and no answer yet. Such a call is drawn
 * in every mode, since the buttons on it are the only way the turn goes on,
 * and it is not dead however long it waits.
 */
export function isAwaitingUser(part: SessionMessagePart.ToolPart) {
  return (
    part.state === "input-available" &&
    isInteractiveTool(getToolNameByType(part.type))
  );
}

/**
 * Whether a call is drawn at all.
 *
 * A call the model has asked for but that the runtime has not reached is left
 * out. It may never run -- stopping the agent drops the rest of the batch -- so
 * drawing it announces work that is not going to happen, and while it waits it
 * has nothing to say that the row ahead of it is not already saying. Developer
 * mode shows the queue, since watching it drain is the point there.
 */
export function isToolCallVisible({
  isDeveloperMode,
  isRunning,
  part,
}: {
  isDeveloperMode: boolean;
  /** Streaming in the live session and running by `isToolPartRunning`. */
  isRunning: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  return (
    hasTerminalToolState(part) ||
    isDeveloperMode ||
    isAwaitingUser(part) ||
    isRunning
  );
}

/**
 * Whether the agent is working on this call right now, as opposed to having
 * asked for it while it waits behind the calls ahead of it. A model emits a
 * batch of calls at once: the read-only ones run together and the rest one at
 * a time, so a batch can have several members running or only one.
 *
 * Input that is still arriving counts: the call is being written, which is the
 * agent doing something. So does a preliminary output, which a streaming tool
 * emits while it keeps going. So does a call with nothing unfinished ahead of
 * it in its message: it is next, and the runtime marks it started in a write of
 * its own a moment after its input lands. Read as queued for that moment, the
 * row would drop out between its input arriving and its run starting and come
 * back a beat later, every step.
 */
export function isToolPartRunning(
  part: SessionMessagePart.ToolPart,
  message: { parts: readonly SessionMessagePart.Type[] },
): boolean {
  switch (part.state) {
    case "input-available": {
      // An interactive call never reaches the queue: it is handed to the user
      // and waits there, so having been asked for is the whole of its running.
      return (
        part.metadata.startedAt !== undefined ||
        isInteractiveTool(getToolNameByType(part.type)) ||
        isNextInLine(part, message)
      );
    }
    case "input-streaming": {
      return true;
    }
    case "output-available": {
      return part.preliminary === true;
    }
    case "output-error": {
      return false;
    }
  }
}

// Whether every call ahead of this one in its message has finished.
function isNextInLine(
  part: SessionMessagePart.ToolPart,
  message: { parts: readonly SessionMessagePart.Type[] },
): boolean {
  for (const other of message.parts) {
    if (other.metadata.id === part.metadata.id) {
      return true;
    }
    if (isToolPart(other) && !hasTerminalToolState(other)) {
      return false;
    }
  }
  return false;
}

/**
 * Drops the preamble a unified patch carries -- the two file names, the rule
 * between them, and the `---`/`+++` pair -- leaving the hunks.
 *
 * Cut at the first hunk header rather than at a line count. The count is right
 * for what the patch library writes today and says nothing about why, so a patch
 * built any other way loses five lines of its own content instead, and a patch
 * with fewer lines than the preamble is emptied entirely. That last one draws as
 * a card with no body, which on screen is indistinguishable from a call that had
 * nothing to say -- the failure is silent exactly where it is least recoverable.
 */
export function stripPatchHeader(diff: string): string {
  const lines = diff.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  // No hunk header at all is not a patch this understands, and showing it whole
  // is more use than showing nothing.
  return firstHunk === -1 ? diff : lines.slice(firstHunk + 1).join("\n");
}
