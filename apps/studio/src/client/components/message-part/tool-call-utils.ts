import {
  getToolNameByType,
  isInteractiveTool,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

type StartActivityPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-start_activity" }
>;

export function hasTerminalToolState(part: SessionMessagePart.ToolPart) {
  return part.state === "output-available" || part.state === "output-error";
}

/**
 * Whether an activity heading draws anything. A title is absent until the first
 * tokens of the call arrive, and a model can call the tool with a blank one, so
 * the indent under a heading has to be decided by the same rule that decides
 * whether the heading is there at all -- otherwise rows sit indented under
 * nothing.
 */
export function isActivityHeadingVisible(part: StartActivityPart): boolean {
  const title = part.input?.title;
  return typeof title === "string" && title.trim() !== "";
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
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  // An activity with no title yet has nothing to draw, so it is not a row in
  // any mode. Counting it as one opens a group the call cannot head, which is a
  // box holding a row that renders nothing: an empty gap in the transcript for
  // as long as the title takes to arrive.
  if (part.type === "tool-start_activity") {
    return isActivityHeadingVisible(part);
  }

  return (
    hasTerminalToolState(part) ||
    isDeveloperMode ||
    (isStreaming && isToolPartRunning(part))
  );
}

/**
 * Whether this call is the one the agent is working on right now, as opposed to
 * one it has asked for and that is still waiting behind the calls ahead of it.
 * A model emits a batch of calls at once and they run one at a time, so most of
 * a batch is idle while a single member of it works.
 *
 * Input that is still arriving counts: the call is being written, which is the
 * agent doing something. So does a preliminary output, which a streaming tool
 * emits while it keeps going.
 */
export function isToolPartRunning(part: SessionMessagePart.ToolPart): boolean {
  // A heading is not a step. `start_activity` touches nothing and returns at
  // once, so while it runs there is nothing to watch and nothing else has
  // started: counting it as the work in flight leaves the group it just opened
  // as a heading with an empty space under it, in the one place the reader was
  // invited to look.
  if (part.type === "tool-start_activity") {
    return false;
  }

  switch (part.state) {
    case "input-available": {
      // An interactive call never reaches the queue: it is handed to the user
      // and waits there, so having been asked for is the whole of its running.
      return (
        part.metadata.startedAt !== undefined ||
        isInteractiveTool(getToolNameByType(part.type))
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
