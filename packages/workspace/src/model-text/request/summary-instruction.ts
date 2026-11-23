/**
 * The headings a summary is written under, in order. A fixed shape is what
 * tells a summary from an answer: measured on Haiku 5.5, one summary request
 * came back as an answer to the user's last question, offering to "write the
 * conversation summary you asked for", and with no shape asked for, nothing
 * told it apart. OpenCode and Pi ask for fixed headings for the same reason.
 */
export const SUMMARY_HEADINGS = [
  "## Goal",
  "## Done and found",
  "## Files",
  "## Decisions",
  "## Next",
] as const;

/**
 * What the model is asked at the end of the request it would have been sent,
 * for a summary the session rolls over onto before a request reaches its
 * model's price step (`prepareModelMessages`). Codex's handoff summary and
 * Anthropic's compaction prompt ask for the same things: the goal and every
 * constraint, what was done and found, and what is left.
 */
export const SUMMARY_INSTRUCTION = `<summarize-conversation>
This conversation is about to be replaced, to keep it small: from here on you will see your instructions, the user's messages, your handoff notes, and a summary you write now in place of everything else above. Write that summary as your whole reply. Do not answer the user, carry on with the task, or call any tool.

Use exactly these headings, under 1,500 words in all, and write "(none)" under one with nothing to say:
${SUMMARY_HEADINGS[0]}
What the user wants overall, and every standing instruction, preference and constraint they gave.
${SUMMARY_HEADINGS[1]}
What has been done and what came of it, with the specific facts, figures, names, IDs, URLs and file paths a later step will need, and which of the user's questions are answered.
${SUMMARY_HEADINGS[2]}
Every file written or changed, and where it is.
${SUMMARY_HEADINGS[3]}
Decisions made and why, and what failed or was ruled out.
${SUMMARY_HEADINGS[4]}
What is in progress and what remains to do next.
</summarize-conversation>`;

/**
 * Asked once more when the first answer was not a summary: it called a tool,
 * which is the model carrying on with the task (measured on Haiku 5.5: "I'll
 * keep going on the returns question...", kept as a summary that replaced a
 * 3,300-character one and lost a quote number the user then asked for), it
 * left out the headings, or it was too short to be one.
 */
export const RETRY_INSTRUCTION = `${SUMMARY_INSTRUCTION}

The last answer to this was not the summary. Tools do nothing here. Write the summary now, as text, under exactly those headings.`;

/**
 * Said after a summary the cap cut off, since what it lost is its end, the
 * work in progress and what remains, which the next window needs most.
 */
export const CUT_OFF_NOTE =
  "[This summary was cut off at its length limit. The conversation's transcript has what it does not cover.]";
