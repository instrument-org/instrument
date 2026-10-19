import { type StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { ChatReads } from "../chat-reads";
import { isToolPart } from "../is-tool-part";
import {
  callActivity,
  clipLine,
  partCreatedAt,
  toolCallLine,
} from "./call-label";

/**
 * One line of a task's transcript read as a sequence of steps: what its agent
 * set out to do, each call it made and how the call ended, what it and the user
 * said, and what the chat sent it. Tool output is left out on purpose. The transcript's last lines are
 * whatever printed last, and a search that listed ten thousand paths reads as a
 * task lost in them; the steps say what the task was doing.
 */
export interface Step {
  at: Date;
  kind: "activity" | "call" | "said" | "sent" | "user";
  text: string;
}

/** How much of a spoken line the outline keeps. */
const SAID_MAX_LENGTH = 200;

/** The outline as text, one step per line, the time in the reader's zone. */
export function renderSteps(steps: Step[]): string {
  return steps
    .map((step) => {
      const time = step.at.toLocaleTimeString("en-US", { hour12: false });
      switch (step.kind) {
        case "activity": {
          return `${time}  ${step.text}`;
        }
        case "call": {
          return `${time}    ${step.text}`;
        }
        case "said": {
          return `${time}  said: ${step.text}`;
        }
        case "sent": {
          return `${time}  you sent: ${step.text}`;
        }
        case "user": {
          return `${time}  user: ${step.text}`;
        }
      }
    })
    .join("\n");
}

/**
 * A session's own steps, oldest first: a task's, without the conversation
 * it carries on from.
 */
export async function sessionSteps({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<Step[]> {
  const messages = await ChatReads.transcript({
    chatId,
    inherited: false,
    sessionId,
  });
  if (messages.isErr()) {
    return [];
  }
  const steps: Step[] = [];
  // The phase the calls so far belong to. A call opens a new one by carrying a
  // different activity, the same reading the transcript draws its headings by.
  let activity: string | undefined;
  for (const message of messages.value) {
    if (message.role === "user") {
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (text) {
        steps.push({
          at: message.metadata.createdAt,
          kind: "user",
          text: clipLine(text, SAID_MAX_LENGTH),
        });
      }
      for (const part of message.parts) {
        if (part.type === "data-fromChat") {
          steps.push({
            at: message.metadata.createdAt,
            kind: "sent",
            text: clipLine(part.data.text, SAID_MAX_LENGTH),
          });
        }
      }
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (text) {
          steps.push({
            at: partCreatedAt(part) ?? message.metadata.createdAt,
            kind: "said",
            text: clipLine(text, SAID_MAX_LENGTH),
          });
        }
        continue;
      }
      if (!isToolPart(part)) {
        continue;
      }
      const at = partCreatedAt(part) ?? message.metadata.createdAt;
      const named = callActivity(part);
      if (named && named !== activity) {
        activity = named;
        steps.push({ at, kind: "activity", text: named });
      }
      steps.push({ at, kind: "call", text: toolCallLine(part) });
    }
  }
  return steps;
}

/**
 * Where a task's agent has gone since a moment, oldest first: the activities
 * its calls named, or each call it made when they named none, which a model
 * can leave out. What an overdue note carries in place of the one latest
 * step, so the conversation reads a trajectory rather than a snapshot.
 */
export async function trajectorySince(
  ref: { sessionId: StoreId.Session; chatId: ChatId },
  since: Date,
): Promise<string[]> {
  const allSteps = await sessionSteps(ref);
  const steps = allSteps.filter((step) => step.at >= since);
  const activities = steps.filter((step) => step.kind === "activity");
  return (
    activities.length > 0
      ? activities
      : steps.filter((step) => step.kind === "call")
  ).map((step) => step.text);
}
