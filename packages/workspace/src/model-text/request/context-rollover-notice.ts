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
 *
 * After a summarized rollover the summary is the record, so the agent is not
 * asked for notes: it was not running out of room, and an agent asked for
 * notes on every request writes them as a visible step and then tells the
 * person about them.
 *
 * `stepCarried` says the cut came right after a step's results and that step
 * was carried across (`carriedStep`), so the agent continues from what its
 * last call returned.
 */
export function contextRolloverNotice(
  notes: string | undefined,
  notesPath: string,
  summarized?: { summary: string },
  stepCarried = false,
): string {
  const carried =
    "The user's messages have been carried across newest first, up to a size budget: older ones may have been dropped whole, and a bracketed [context rollover omitted ...] line stands where the middle of an oversized one was cut. Treat a line like that, or an earlier instruction you cannot find, as something to ask the user about rather than something that never existed.";
  const lastStep = stepCarried
    ? " Your last step before the cut, its calls and their results, is carried across as it was: continue from those results rather than calling again."
    : "";
  const preamble =
    summarized === undefined
      ? `This conversation ran out of context and continued in a fresh window. ${carried} Your own earlier turns have not been carried across${stepCarried ? ", except your last step" : " at all"}: the work you did, what you read, and anything you worked out before ${stepCarried ? "that step" : "the cut"} are no longer in front of you.${lastStep}`
      : `This conversation was summarized to keep it small, and continued in a fresh window. ${carried} Your own earlier turns are replaced by the summary below, which you wrote at the cut: treat what it says as established rather than something to rediscover. It covers the conversation only up to the cut, though it comes last here: anything in this window from after the cut, your own turns included, is newer, and wins where the two differ.${lastStep}`;
  const summary =
    summarized === undefined
      ? []
      : ["", "<summary>", summarized.summary, "</summary>"];

  const handedBack =
    notes === undefined
      ? summarized === undefined
        ? [
            "",
            `No handoff notes were found at \`${notesPath}\`. Treat what is in this window as the remainder of the task rather than the whole of it, and write your notes there before the room runs out again.`,
          ]
        : []
      : [
          "",
          `These are the handoff notes you left at \`${notesPath}\`. They are your own account of the work above${summarized === undefined ? ", and the only one still in front of you" : ""}, so treat what they say about the task as established rather than something to rediscover:`,
          "",
          notes,
          ...(summarized === undefined
            ? ["", `Keep them current at \`${notesPath}\` as the task moves.`]
            : []),
        ];

  return [
    "<context-rollover>",
    preamble,
    ...summary,
    ...handedBack,
    "",
    CONTEXT_PRIVATE,
    "</context-rollover>",
  ].join("\n");
}

/**
 * Said wherever the agent is told about rollovers or its notes. The notes file
 * sits in the chat's folder beside what the agent made, so without this an
 * agent offers it to the person as one more result.
 */
export const CONTEXT_PRIVATE =
  "Rollovers, summaries and handoff notes are your own bookkeeping, not part of the answer: never mention them or link the notes file in a reply. Asking the user about a detail you lost is fine.";
