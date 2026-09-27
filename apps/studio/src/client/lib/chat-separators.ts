import {
  type SessionMessage,
  type StoreId,
} from "@instrument-org/workspace/client";
import { format, isSameDay } from "date-fns";

import { modelsAnswering, type ModelUsage } from "./models-answered";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a chat has to sit quiet before the next message gets a separator of
 * its own, the way a text thread marks a return to it.
 */
const SEPARATOR_GAP_MS = HOUR_MS;

/**
 * A line drawn above a message the person sent: when it was sent, and, where
 * the chat starts or the person switched models, the model it went to.
 */
export interface ChatSeparator {
  at: Date;
  /** Absent on a separator that only marks a gap in time. */
  usage?: ModelUsage;
}

/**
 * Where the conversation's separators go, keyed by the user message each sits
 * above.
 *
 * One above the first message, naming the model. One above any message sent
 * {@link SEPARATOR_GAP_MS} or more after the one before it, or on a later day,
 * with the time alone. One above the first message after a switch of model,
 * naming the new one, gap or not.
 *
 * A user message carries no model; the one it went to is the model its reply
 * asked for, so a separator names nothing until the reply's first message
 * exists. The card behind a named model covers every reply up to the next
 * switch, which is how a router's picks across that run reach it without each
 * pick drawing a line of its own: the person chose the router, and a new line
 * is for a choice they made.
 */
export function chatSeparators(
  messages: readonly SessionMessage.WithParts[],
): Map<StoreId.Message, ChatSeparator> {
  const separators = new Map<StoreId.Message, ChatSeparator>();
  // The replies under the latest separator that named a model, collected until
  // the next one does.
  let named:
    | undefined
    | { replies: SessionMessage.AssistantWithParts[]; userId: StoreId.Message };
  const runs: NonNullable<typeof named>[] = [];
  let lastModel: string | undefined;
  let previous: SessionMessage.WithParts | undefined;

  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant") {
      named?.replies.push(message);
    }
    if (message.role === "user") {
      const model = replyModel(messages, index);
      const at = message.metadata.createdAt;
      const isFirst = runs.length === 0;
      const switched =
        model !== undefined && lastModel !== undefined && model !== lastModel;

      if (isFirst || switched) {
        named = { replies: [], userId: message.id };
        runs.push(named);
        separators.set(message.id, { at });
      } else if (previous && isGap(previous.metadata.createdAt, at)) {
        separators.set(message.id, { at });
      }
      lastModel = model ?? lastModel;
    }
    if (message.role !== "session-context") {
      previous = message;
    }
  }

  for (const run of runs) {
    const [usage] = modelsAnswering(run.replies);
    const separator = separators.get(run.userId);
    if (separator && usage) {
      separator.usage = usage;
    }
  }
  return separators;
}

/**
 * The separator's day, in the words a text thread uses: Today and Yesterday,
 * the weekday within the week, the date past it, and the year only when it is
 * not this one.
 */
export function separatorDayLabel(date: Date, now: Date): string {
  if (isSameDay(date, now)) {
    return "Today";
  }
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const daysAgo = Math.ceil((startOfToday - date.getTime()) / DAY_MS);
  if (daysAgo <= 1) {
    return "Yesterday";
  }
  if (daysAgo < 7) {
    return format(date, "EEEE");
  }
  return format(
    date,
    date.getFullYear() === now.getFullYear()
      ? "EEE, MMM d"
      : "EEE, MMM d, yyyy",
  );
}

/** The separator's time of day, as the clock shows it. */
export function separatorTimeLabel(date: Date): string {
  return format(date, "p");
}

function isGap(before: Date, after: Date): boolean {
  return (
    after.getTime() - before.getTime() >= SEPARATOR_GAP_MS ||
    !isSameDay(before, after)
  );
}

/** The model the reply to the user message at `index` asked for, once it has one. */
function replyModel(
  messages: readonly SessionMessage.WithParts[],
  index: number,
): string | undefined {
  for (const message of messages.slice(index + 1)) {
    if (message.role === "user") {
      return undefined;
    }
    if (
      message.role === "assistant" &&
      message.metadata.modelId &&
      !message.metadata.synthetic
    ) {
      return message.metadata.aiGatewayModel?.uri ?? message.metadata.modelId;
    }
  }
  return undefined;
}
