import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type TelemetryOptions,
  type ToolSet,
} from "ai";
import { mapValues } from "radashi";

import {
  CUT_OFF_NOTE,
  RETRY_INSTRUCTION,
  SUMMARY_HEADINGS,
  SUMMARY_INSTRUCTION,
} from "../model-text/request/summary-instruction";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Room for the summary the instruction asks for and then some: measured on
 * Haiku 5.5, summaries ran to 1,700 to 4,000 tokens, and 3 of 17 stopped at
 * a cap of 4,000.
 */
const SUMMARY_MAX_OUTPUT_TOKENS = 8_000;

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
