import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type TelemetryOptions,
  type ToolSet,
} from "ai";
import { mapValues } from "radashi";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The headings a summary is written under, in order. A fixed shape is what
 * tells a summary from an answer: measured on Haiku 5.5, one summary request
 * came back as an answer to the user's last question, offering to "write the
 * conversation summary you asked for", and with no shape asked for, nothing
 * told it apart. OpenCode and Pi ask for fixed headings for the same reason.
 */
const SUMMARY_HEADINGS = [
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
const SUMMARY_INSTRUCTION = `<summarize-conversation>
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
 * Room for the summary the instruction asks for and then some: measured on
 * Haiku 5.5, summaries ran to 1,700 to 4,000 tokens, and 3 of 17 stopped at
 * a cap of 4,000.
 */
const SUMMARY_MAX_OUTPUT_TOKENS = 8_000;

/**
 * Asked once more when the first answer was not a summary: it called a tool,
 * which is the model carrying on with the task (measured on Haiku 5.5: "I'll
 * keep going on the returns question...", kept as a summary that replaced a
 * 3,300-character one and lost a quote number the user then asked for), it
 * left out the headings, or it was too short to be one.
 */
const RETRY_INSTRUCTION = `${SUMMARY_INSTRUCTION}

The last answer to this was not the summary. Tools do nothing here. Write the summary now, as text, under exactly those headings.`;

/**
 * The shortest text taken as a summary. One is drawn only once a window has
 * grown to most of its model's price step, tens of thousands of tokens, and a
 * summary of that under this length has kept too little to work from:
 * measured on a beta chat that rolled over 123 times on Haiku 5.5, the two
 * summaries under it were replies to the user, each replacing a summary of
 * thousands of characters.
 */
const SUMMARY_MIN_CHARACTERS = 1_000;

/**
 * A summary is text of at least {@link SUMMARY_MIN_CHARACTERS}, with no tool
 * called, under every heading, or under the first of them where the length
 * limit cut it off, since a cut takes the later headings with it and what
 * came before the cut is still the summary.
 */
function isSummary({
  cutOff,
  text,
  toolCalls,
}: {
  cutOff: boolean;
  text: string;
  toolCalls: number;
}): boolean {
  const lines = new Set(text.split("\n").map((line) => line.trim()));
  return (
    toolCalls === 0 &&
    text.trim().length >= SUMMARY_MIN_CHARACTERS &&
    (cutOff ? SUMMARY_HEADINGS.slice(0, 1) : SUMMARY_HEADINGS).every(
      (heading) => lines.has(heading),
    )
  );
}

/**
 * Said after a summary the cap cut off, since what it lost is its end, the
 * work in progress and what remains, which the next window needs most.
 */
const CUT_OFF_NOTE =
  "[This summary was cut off at its length limit. The conversation's transcript has what it does not cover.]";

/**
 * The model's summary of the conversation in `messages`, which are the
 * request as it would have been sent: the same system prompt, tools and
 * history, with the instruction after them, so the provider serves the
 * prefix from its cache. The tools go with their definitions and without
 * their execution, so the prefix matches and nothing runs if the model calls
 * one anyway. Undefined when the call fails or writes no text.
 */
export async function summarizeBeforePriceStep({
  activity,
  headers,
  messages,
  model,
  providerOptions,
  signal,
  tools,
}: {
  /** What the activity log records the call as (`activityTelemetry`). */
  activity: TelemetryOptions;
  headers: Record<string, string>;
  messages: ModelMessage[];
  model: LanguageModel;
  providerOptions: Parameters<typeof generateText>[0]["providerOptions"];
  signal: AbortSignal;
  tools: ToolSet;
}): Promise<
  | {
      summary: string;
      usage: SessionMessageDataPart.ContextRolloverDataPart["summaryUsage"];
    }
  | undefined
> {
  try {
    const ask = (instruction: string) =>
      generateText({
        abortSignal: signal,
        allowSystemInMessages: true,
        headers,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        messages: [...messages, { content: instruction, role: "user" }],
        model,
        providerOptions,
        telemetry: activity,
        tools: mapValues(
          tools,
          ({ execute: _execute, ...definition }) => definition,
        ),
      });
    const first = await ask(SUMMARY_INSTRUCTION);
    const accepted = (answer: typeof first) =>
      isSummary({
        cutOff: answer.finishReason === "length",
        text: answer.text,
        toolCalls: answer.toolCalls.length,
      });
    const retried = !accepted(first);
    const result = retried ? await ask(RETRY_INSTRUCTION) : first;
    const text = result.text.trim();
    if (!accepted(result)) {
      return undefined;
    }
    const summary =
      result.finishReason === "length" ? `${text}\n\n${CUT_OFF_NOTE}` : text;
    const usage = result.totalUsage;
    const spent = (pick: (u: typeof usage) => number | undefined) =>
      retried
        ? (pick(first.totalUsage) ?? 0) + (pick(usage) ?? 0)
        : pick(usage);
    return {
      summary,
      usage: {
        cacheReadTokens: spent((u) => u.inputTokenDetails.cacheReadTokens),
        cacheWriteTokens: spent((u) => u.inputTokenDetails.cacheWriteTokens),
        inputTokens: spent((u) => u.inputTokens),
        outputTokens: spent((u) => u.outputTokens),
        raw: usage.raw,
      },
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error, {
      area: "price-step-summary",
    });
    return undefined;
  }
}
