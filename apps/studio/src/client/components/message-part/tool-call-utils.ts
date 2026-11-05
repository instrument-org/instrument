import { type SessionMessagePart } from "@instrument-org/workspace/client";

/** Whether a call is still being written or run. */
export function isActiveToolPart(part: SessionMessagePart.ToolPart) {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.preliminary === true)
  );
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
