/**
 * What the agent is handed once its own earlier turns have stopped being sent.
 *
 * The notes are inlined rather than pointed at, which is the whole lesson of
 * the version this replaces. Told where its notes were and to go and read them,
 * an agent mid-task did not: it costs a tool call and a decision, against a
 * user message right in front of it asking for something else. What arrives in
 * the request costs neither.
 *
 * Derived per request and never persisted, so it tracks the file as the agent
 * rewrites it, and appended after the cache breakpoints so its contents cannot
 * move the cached prefix.
 */
export function contextRolloverNotice(
  notes: string | undefined,
  notesPath: string,
  summarized?: { summary: string; transcriptPath: string | undefined },
): string {
  const carried =
    "The user's messages have been carried across newest first, up to a size budget: older ones may have been dropped whole, and a bracketed [context rollover omitted ...] line stands where the middle of an oversized one was cut. Treat a line like that, or an earlier instruction you cannot find, as something to ask the user about rather than something that never existed.";
  const preamble =
    summarized === undefined
      ? `This conversation ran out of context and continued in a fresh window. ${carried} Your own earlier turns have not been carried across at all: the work you did, what you read, and anything you worked out before the cut are no longer in front of you.`
      : `This conversation was summarized to keep it small, and continued in a fresh window. ${carried} Your own earlier turns are replaced by the summary below, which you wrote at the cut: treat what it says as established rather than something to rediscover. It covers the conversation only up to the cut, though it comes last here: anything in this window from after the cut, your own turns included, is newer, and wins where the two differ.${summarized.transcriptPath === undefined ? "" : ` The whole conversation so far is in \`${summarized.transcriptPath}\`, if a detail the summary left out matters.`}`;
  const summary =
    summarized === undefined
      ? []
      : ["", "<summary>", summarized.summary, "</summary>"];

  if (notes === undefined) {
    return [
      "<context-rollover>",
      preamble,
      ...summary,
      "",
      `No handoff notes were found at \`${notesPath}\`. Treat what is in this window as the remainder of the task rather than the whole of it, and write your notes there before the room runs out again.`,
      "</context-rollover>",
    ].join("\n");
  }

  return [
    "<context-rollover>",
    preamble,
    ...summary,
    "",
    `These are the handoff notes you left at \`${notesPath}\`. They are your own account of the work above, and the only one still in front of you, so treat what they say about the task as established rather than something to rediscover:`,
    "",
    notes,
    "",
    `Keep them current at \`${notesPath}\` as the task moves.`,
    "</context-rollover>",
  ].join("\n");
}
