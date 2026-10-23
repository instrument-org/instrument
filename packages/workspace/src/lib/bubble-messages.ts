import { isEqual } from "radashi";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { dataPartVisibility } from "./data-part-visibility";

/**
 * What a chat's bubbles draw of its conversation, and nothing else: the words,
 * what a sent message carries, the cards that ask the user something, and the
 * notes everyone sees, with the image and search calls the note over the reply
 * box reads. The steps the agent took are the task card's, read from
 * the whole transcript.
 *
 * A reply lands whole, so the words of the step still being written are left
 * out until it finishes, and `drafting` says the dots stand in for them. A
 * token arriving therefore changes nothing here, and the feed built on this
 * sends nothing for it.
 */
export interface BubbleFeed {
  /** The conversation is writing words the user will get. */
  drafting: boolean;
  messages: SessionMessage.WithParts[];
}

/** What the feed sends: the whole of it first, then only what moved. */
export type BubbleFeedEvent =
  | ({ kind: "reset" } & BubbleFeed)
  | {
      drafting: boolean;
      kind: "change";
      removed: StoreId.Message[];
      upserted: SessionMessage.WithParts[];
    };

/**
 * Parts a sent message is drawn with though the transcript hides them as
 * rows: the files and folders, the message it answers, the chips it went
 * with.
 */
const SENT_WITH = new Set<SessionMessagePart.Type["type"]>([
  "data-attachments",
  "data-reply",
  "data-viewContext",
]);

/**
 * The message as the bubbles draw it, or nothing when it is not one of the
 * conversation's. The same object when every part stays, so a reader that
 * compares by identity sees no change.
 */
export function bubbleMessage(
  message: SessionMessage.WithParts,
  { composing }: { composing: boolean },
): SessionMessage.WithParts | undefined {
  if (message.role === "session-context") {
    return undefined;
  }
  const parts = message.parts.filter((part) => keepsPart(part, composing));
  return parts.length === message.parts.length
    ? message
    : { ...message, parts };
}

function keepsPart(part: SessionMessagePart.Type, composing: boolean) {
  switch (part.type) {
    case "text": {
      return !composing;
    }
    // A card that asks the user draws once it has the whole question.
    case "tool-choose": {
      return part.state !== "input-streaming";
    }
    // A sign-in card draws once the call names the app, unless the tool
    // refused it, which is the agent's to fix rather than the user's to read.
    case "tool-connect_app": {
      return (
        part.state === "output-error" ||
        (part.state === "output-available" && part.output.state !== "failure")
      );
    }
    // An image call that ran into a sign-in or the account's plan, and a
    // search Instrument turned away for the plan, for the note over the reply
    // box to read: it offers the way forward, and the bubbles draw no card
    // for either.
    case "tool-generate_image": {
      return (
        part.state === "output-available" &&
        part.output.state === "failure" &&
        (part.output.errorType === "no-image-model" ||
          part.output.errorType === "refused")
      );
    }
    case "tool-web_search": {
      return (
        part.state === "output-available" &&
        part.output.state === "success" &&
        part.output.platformRefusal !== undefined
      );
    }
    default: {
      return (
        isDataPart(part) &&
        (SENT_WITH.has(part.type) || dataPartVisibility(part) === "always")
      );
    }
  }
}

function isDataPart(
  part: SessionMessagePart.Type,
): part is SessionMessagePart.DataPart {
  return part.type.startsWith("data-");
}

/**
 * The session's last reply, while its agent is still writing it. Whatever
 * came after it is passed over: a session's first request writes its
 * baseline after the reply it is answering in was created, and a message the
 * user sends or a task's news lands while the reply is still being written.
 */
function composingMessage(
  messages: readonly SessionMessage.WithParts[],
  isRunning: boolean,
): SessionMessage.WithParts | undefined {
  const last = messages.findLast((message) => message.role === "assistant");
  return isRunning &&
    last?.role === "assistant" &&
    last.metadata.finishedAt === undefined
    ? last
    : undefined;
}

/**
 * Keeps the bubbles of one session as its messages change, and says what
 * moved since the last time it was asked.
 */
export class BubbleProjection {
  private drafting = false;
  private readonly shown = new Map<StoreId.Message, SessionMessage.WithParts>();
  private composingId: StoreId.Message | undefined;

  /**
   * The bubbles of `messages` (the whole session, in order), and which of
   * them differ from the last call: only `touched`, and the messages that
   * started or stopped being written, are compared again.
   */
  update({
    isRunning,
    messages,
    touched,
  }: {
    isRunning: boolean;
    messages: readonly SessionMessage.WithParts[];
    touched?: ReadonlySet<StoreId.Message>;
  }): { feed: BubbleFeed; event: BubbleFeedEvent | undefined } {
    const composing = composingMessage(messages, isRunning);
    const recheck = new Set(touched);
    for (const id of [this.composingId, composing?.id]) {
      if (id !== undefined) {
        recheck.add(id);
      }
    }
    this.composingId = composing?.id;

    const present = new Set<StoreId.Message>();
    const upserted: SessionMessage.WithParts[] = [];
    for (const message of messages) {
      present.add(message.id);
      if (touched !== undefined && !recheck.has(message.id)) {
        continue;
      }
      const next = bubbleMessage(message, {
        composing: message.id === composing?.id,
      });
      const previous = this.shown.get(message.id);
      if (next === undefined) {
        this.shown.delete(message.id);
        continue;
      }
      if (previous === undefined || !isEqual(previous, next)) {
        this.shown.set(message.id, next);
        upserted.push(next);
      }
    }
    const removed = [...this.shown.keys()].filter((id) => !present.has(id));
    for (const id of removed) {
      this.shown.delete(id);
    }

    const drafting = composing?.parts.at(-1)?.type === "text";
    const moved =
      touched === undefined ||
      upserted.length > 0 ||
      removed.length > 0 ||
      drafting !== this.drafting;
    this.drafting = drafting;

    const feed: BubbleFeed = {
      drafting,
      messages: messages.flatMap((message) => {
        const shown = this.shown.get(message.id);
        return shown ? [shown] : [];
      }),
    };
    if (!moved) {
      return { event: undefined, feed };
    }
    return {
      event:
        touched === undefined
          ? { kind: "reset", ...feed }
          : { drafting, kind: "change", removed, upserted },
      feed,
    };
  }
}

/** Applies what the feed sent to what the reader holds. */
export function applyBubbleFeedEvent(
  current: BubbleFeed | undefined,
  event: BubbleFeedEvent,
): BubbleFeed {
  if (event.kind === "reset" || current === undefined) {
    return event.kind === "reset"
      ? { drafting: event.drafting, messages: event.messages }
      : { drafting: event.drafting, messages: event.upserted };
  }
  const removed = new Set(event.removed);
  const byId = new Map(event.upserted.map((message) => [message.id, message]));
  const messages = current.messages
    .filter((message) => !removed.has(message.id))
    .map((message) => {
      const next = byId.get(message.id);
      byId.delete(message.id);
      return next ?? message;
    });
  // New messages arrive in id order, which is the session's order.
  for (const message of byId.values()) {
    const at = messages.findIndex((other) => other.id > message.id);
    if (at === -1) {
      messages.push(message);
    } else {
      messages.splice(at, 0, message);
    }
  }
  return { drafting: event.drafting, messages };
}
