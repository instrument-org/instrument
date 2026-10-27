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
 * What the model is asked at the end of the request it would have been sent,
 * for a summary the session rolls over onto before a request reaches its
 * model's price step (`prepareModelMessages`). Codex's handoff summary and
 * Anthropic's compaction prompt ask for the same things: the goal and every
 * constraint, what was done and found, and what is left.
 */
const SUMMARY_INSTRUCTION = `<summarize-conversation>
This conversation is about to be replaced, to keep it small: from here on you will see your instructions, the user's messages, your handoff notes, and a summary you write now in place of everything else above. Write that summary. Do not call any tool.

Cover, in plain text under 1,500 words:
- What the user wants overall, and every standing instruction, preference and constraint they gave.
- What has been done and what came of it, with the specific facts, figures, names, URLs and file paths a later step will need.
- Every file written or changed, and where it is.
- Decisions made and why, and what failed or was ruled out.
- What is in progress and what remains to do next.
</summarize-conversation>`;

/** Room for the summary the instruction asks for, and no more. */
const SUMMARY_MAX_OUTPUT_TOKENS = 4_000;

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
    const result = await generateText({
      abortSignal: signal,
      allowSystemInMessages: true,
      headers,
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      messages: [...messages, { content: SUMMARY_INSTRUCTION, role: "user" }],
      model,
      providerOptions,
      telemetry: activity,
      tools: mapValues(
        tools,
        ({ execute: _execute, ...definition }) => definition,
      ),
    });
    const summary = result.text.trim();
    if (summary === "") {
      return undefined;
    }
    const usage = result.totalUsage;
    return {
      summary,
      usage: {
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
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
