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
 * 3,300-character one and lost a quote number the user then asked for), or
 * it left out the headings.
 */
const RETRY_INSTRUCTION = `${SUMMARY_INSTRUCTION}

The last answer to this was not the summary. Tools do nothing here. Write the summary now, as text, under exactly those headings.`;

/** A summary is text, under every heading, with no tool called. */
function isSummary(text: string, toolCalls: number): boolean {
  return (
    toolCalls === 0 &&
    SUMMARY_HEADINGS.every((heading) =>
      text.split("\n").some((line) => line.trim() === heading),
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
    // A length cut can take the later headings with it, and what came before
    // the cut is still the summary.
    const accepted = (answer: typeof first) =>
      answer.finishReason === "length"
        ? answer.toolCalls.length === 0 && answer.text.trim() !== ""
        : isSummary(answer.text, answer.toolCalls.length);
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
