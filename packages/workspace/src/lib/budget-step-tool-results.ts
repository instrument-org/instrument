import type { ModelMessage, ToolModelMessage, ToolResultPart } from "ai";

import { allocateFairShare } from "./fair-share";
import { viewToolOutputItem } from "./model-message-parts";
import {
  takeEndWithoutSplitting,
  truncateWithoutSplitting,
} from "./sanitize-model-text";

type ToolPart = ToolModelMessage["content"][number];

/**
 * How much tool-result text one assistant step may put in front of the model.
 *
 * Per-tool limits bound one call and say nothing about a step containing
 * several. A model can ask for five searches, or a search and three commands,
 * in a single step, and each result is individually within its own limit while
 * the group is not: the largest observed jump was 25,896 tokens across one
 * step's calls. This is the ceiling on the group, which is the number that
 * decides how much of the window one round trip can spend.
 *
 * 32 KB fits one bash result at its own 20 KB cap plus useful output from
 * something else, and refuses five retrieval calls an open-ended amount.
 */
const STEP_TEXT_BUDGET = 32 * 1024;

/**
 * How much of a trimmed result is taken from its end rather than its start.
 *
 * The head is where a result says what it is, but the tail is where several
 * tools put the thing that makes a partial result recoverable: the path a
 * spilled output was saved to, and -- for anything delivered inside a content
 * boundary -- the marker that closes the block. Dropping that marker would
 * leave the boundary open, and every message after it reading as quoted page
 * content.
 */
const TAIL_CHARACTERS = 512;

/** One result the step budget clipped, for telemetry. Numbers only. */
export interface ClippedToolResult {
  originalCharacters: number;
  retainedCharacters: number;
  /** Where the step it belongs to sits in the returned messages. */
  stepIndex: number;
  /** How many results shared the budget with it. */
  stepResultCount: number;
  toolName: string;
}

/**
 * Hold all of one assistant step's tool results to a combined text budget.
 *
 * Grouping is by `tool` message, which the AI SDK emits one of per assistant
 * step, so the group is exactly the set of calls the model made together.
 * Capacity is shared max-min rather than first come first served: whichever
 * tool happened to finish first should not be the one that gets to spend the
 * window, and the fifth result is as likely to be the one that mattered.
 *
 * Every result keeps its own message and its own position. A provider validates
 * that each tool call has a result, so content is replaced in place and nothing
 * is dropped, reordered, or merged.
 *
 * Runs on every replay rather than when a tool finishes, so it bounds sessions
 * recorded before it existed and does not depend on which provider serves the
 * next turn. A result inside the budget comes back the same object it went in
 * as.
 *
 * Results a provider executed for itself ride on the assistant message instead
 * and are left alone: we did not transform that content on the way in and
 * cannot say what clipping it would break.
 */
export function budgetStepToolResults(messages: ModelMessage[]): {
  clipped: ClippedToolResult[];
  messages: ModelMessage[];
} {
  const clipped: ClippedToolResult[] = [];

  const budgeted = messages.map((message, stepIndex) => {
    if (message.role !== "tool") {
      return message;
    }

    const lengths = message.content.map((part) => textLength(part));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total <= STEP_TEXT_BUDGET) {
      return message;
    }

    const allowances = allocateFairShare(lengths, STEP_TEXT_BUDGET);
    const content = message.content.map((part, index) => {
      const length = lengths[index] ?? 0;
      const allowance = allowances[index] ?? 0;
      if (part.type !== "tool-result" || length <= allowance) {
        return part;
      }

      const trimmed = clipResult(part, allowance);
      clipped.push({
        originalCharacters: length,
        retainedCharacters: trimmed.retained,
        stepIndex,
        stepResultCount: message.content.length,
        toolName: part.toolName,
      });
      return trimmed.part;
    });

    return { ...message, content };
  });

  return { clipped, messages: budgeted };
}

/**
 * Replace the middle of one result's text with a notice of what is missing.
 *
 * The notice sits outside the allowance rather than inside it. It is a fixed
 * couple of hundred characters against a 32 KB budget, and the alternative --
 * charging a result for the sentence explaining that it was cut -- makes the
 * smallest allowances describe themselves and carry nothing.
 */
function clipResult(
  part: ToolResultPart,
  allowance: number,
): { part: ToolResultPart; retained: number } {
  const { output } = part;

  switch (output.type) {
    case "content": {
      // Text items compete within the result the same way results compete
      // within the step, so a result whose text is split across items is not
      // budgeted differently from one that keeps it in a single item.
      const views = output.value.map((item) => viewToolOutputItem(item));
      const lengths = views.map((view) =>
        view.kind === "text" ? view.text.length : 0,
      );
      const allowances = allocateFairShare(lengths, allowance);
      let retained = 0;

      const value = output.value.map((item, index) => {
        const view = views[index];
        const length = lengths[index] ?? 0;
        const itemAllowance = allowances[index] ?? 0;
        if (view?.kind !== "text") {
          return item;
        }
        if (length <= itemAllowance) {
          retained += length;
          return item;
        }
        const clipped = clipText(view.text, itemAllowance);
        retained += clipped.retained;
        return view.replace(clipped.text);
      });

      return { part: { ...part, output: { ...output, value } }, retained };
    }
    case "error-text":
    case "text": {
      const clipped = clipText(output.value, allowance);
      return {
        part: { ...part, output: { ...output, value: clipped.text } },
        retained: clipped.retained,
      };
    }
    default: {
      // Nothing we produce arrives as JSON or a denial, and both carry
      // structure that a character cut would corrupt rather than shorten.
      return { part, retained: textLength(part) };
    }
  }
}

function clipText(text: string, allowance: number) {
  const tailLength = Math.min(TAIL_CHARACTERS, Math.floor(allowance / 4));
  const head = truncateWithoutSplitting(text, allowance - tailLength);
  const tail = takeEndWithoutSplitting(text, tailLength);
  const retained = head.length + tail.length;
  const notice = `[Trimmed to fit the combined budget for this step's tool results: ${retained} of ${text.length} characters shown, taken from the start and the end. Run the call again for a narrower result, or use whatever recovery path it names -- a saved output file, a source URL -- if you need what is missing.]`;

  return {
    retained,
    text:
      tail === "" ? `${head}\n\n${notice}` : `${head}\n\n${notice}\n\n${tail}`,
  };
}

function textLength(part: ToolPart): number {
  if (part.type !== "tool-result") {
    return 0;
  }
  const { output } = part;
  switch (output.type) {
    case "content": {
      let total = 0;
      for (const item of output.value) {
        const view = viewToolOutputItem(item);
        if (view.kind === "text") {
          total += view.text.length;
        }
      }
      return total;
    }
    case "error-text":
    case "text": {
      return output.value.length;
    }
    default: {
      return 0;
    }
  }
}
