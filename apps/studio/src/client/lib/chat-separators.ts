import {
  type SessionMessage,
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { format, isSameDay } from "date-fns";

import { modelsAnswering, type ModelUsage } from "./models-answered";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a chat has to sit quiet before the next message gets a separator of
 * its own, the way a text chat marks a return to it.
 */
const SEPARATOR_GAP_MS = HOUR_MS;

/**
 * A line drawn above a message the person sent: when it was sent, and, where
 * the chat starts or the person switched models, the model it went to.
 */
export interface ChatSeparator {
  at: Date;
  /** The switch of model the message was sent with, as its turn recorded it. */
  change?: { from: ModelSide; to: ModelSide };
  /**
   * Whether the line shows the day and time: above the chat's first message
   * and after a gap, but not on a switch of model within the hour, where the
   * line names only the models.
   */
  timed: boolean;
  /** The model the chat starts on, above its first message, once a reply asked it. */
  usage?: ModelUsage;
}

/**
 * One side of a switch: what the turn recorded at the moment of the switch,
 * and what the replies on that model did, once there are any.
 */
export interface ModelSide {
  recorded: SessionMessageDataPart.ModelChangeDataPart["from"];
  usage?: ModelUsage;
}

/**
 * Where the conversation's separators go, keyed by the user message each sits
 * above.
 *
 * One above the first message, naming the model. One above any message sent
 * {@link SEPARATOR_GAP_MS} or more after the one before it, or on a later day,
 * with the time alone. One above every message its turn recorded a switch of
 * model on (`data-modelChange`), naming both models, with the time only when it
 * also follows a gap.
 *
 * A switch is placed by the record its turn wrote, never inferred from which
 * model the replies around a message asked: those are read in landing order,
 * which moves while replies are still being written, so an inferred switch
 * lands on one message live and another once the chat is opened again. The
 * replies only fill in the card behind each model, which covers every reply up
 * to the next switch: a router's picks reach it without each pick drawing a
 * line of its own, since the person chose the router and a line is for a
 * choice they made.
 */
export function chatSeparators(
  messages: readonly SessionMessage.WithParts[],
): Map<StoreId.Message, ChatSeparator> {
  const separators = new Map<StoreId.Message, ChatSeparator>();
  // The replies after the first message and after each switch, collected
  // until the next switch.
  let run:
    | undefined
    | { replies: SessionMessage.AssistantWithParts[]; userId: StoreId.Message };
  const runs: NonNullable<typeof run>[] = [];
  let previous: SessionMessage.WithParts | undefined;

  for (const message of messages) {
    if (message.role === "assistant") {
      run?.replies.push(message);
    }
    if (message.role === "user") {
      const at = message.metadata.createdAt;
      const isFirst = runs.length === 0;
      const change = message.parts.find(
        (part) => part.type === "data-modelChange",
      );
      const gap =
        previous !== undefined && isGap(previous.metadata.createdAt, at);

      if (isFirst || change) {
        run = { replies: [], userId: message.id };
        runs.push(run);
        separators.set(message.id, {
          at,
          change: change && {
            from: { recorded: change.data.from },
            to: { recorded: change.data.to },
          },
          timed: isFirst || gap,
        });
      } else if (gap) {
        separators.set(message.id, { at, timed: true });
      }
    }
    if (message.role !== "session-context") {
      previous = message;
    }
  }

  for (const [index, { replies, userId }] of runs.entries()) {
    const separator = separators.get(userId);
    if (separator?.change) {
      // The model moved from is the one the run before last asked.
      separator.change.from.usage = runUsage(runs[index - 1]?.replies, "last");
      separator.change.to.usage = runUsage(replies, "first");
    } else if (separator) {
      separator.usage = runUsage(replies, "first");
    }
  }
  return separators;
}

/**
 * What the run's first or last asked model did across every reply of the run
 * that asked it.
 */
function runUsage(
  replies: readonly SessionMessage.AssistantWithParts[] | undefined,
  which: "first" | "last",
): ModelUsage | undefined {
  const asked = (reply: SessionMessage.AssistantWithParts) =>
    reply.metadata.aiGatewayModel?.uri ?? reply.metadata.modelId;
  const counted = (replies ?? []).filter(
    (reply) => reply.metadata.modelId && !reply.metadata.synthetic,
  );
  const pick = which === "first" ? counted.at(0) : counted.at(-1);
  if (!pick) {
    return undefined;
  }
  const [usage] = modelsAnswering(
    counted.filter((reply) => asked(reply) === asked(pick)),
  );
  return usage;
}

/**
 * The separator's day, in the words a text chat uses: Today and Yesterday,
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
