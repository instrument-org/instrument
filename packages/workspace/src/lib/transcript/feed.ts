import { isEqual } from "radashi";

import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import {
  type TranscriptMessage,
  transcriptMessage,
  type TranscriptPart,
} from "./transcript-message";
import { opensTurn } from "./turns-of";

/** What a reader holds of a session's transcript. */
export interface TranscriptFeed {
  /** There are earlier turns than these, read by asking for them. */
  hasOlder: boolean;
  messages: TranscriptMessage[];
}

/** One part that moved: its whole self, or just the words added to it. */
type PartPatch =
  | {
      kind: "append";
      messageId: StoreId.Message;
      partId: StoreId.Part;
      text: string;
    }
  | { kind: "part"; messageId: StoreId.Message; part: TranscriptPart };

/**
 * What the feed sends: the end of the session first, then only what moved. A
 * token arriving is a few words, not the message they land in, and a message
 * of a hundred calls costs what its one running call costs.
 */
export type TranscriptFeedEvent =
  | ({ kind: "reset" } & TranscriptFeed)
  | {
      kind: "change";
      patches: PartPatch[];
      removed: StoreId.Message[];
      upserted: TranscriptMessage[];
    };

/** How many turns a reader is given at a time. */
const TURNS_PER_PAGE = 20;

/**
 * The messages of the last `turns` turns of `messages` (a session, oldest
 * first), up to `before` when it is given, and whether any are left above them.
 */
export function lastTurnsOf(
  messages: readonly SessionMessage.WithParts[],
  {
    before,
    isDeveloperMode,
    turns = TURNS_PER_PAGE,
  }: { before?: StoreId.Message; isDeveloperMode: boolean; turns?: number },
): TranscriptFeed {
  const end =
    before === undefined
      ? messages.length
      : messages.findIndex((message) => message.id === before);
  const upTo = end === -1 ? messages.length : end;
  let start = upTo;
  let opened = 0;
  while (start > 0 && opened < turns) {
    start--;
    const message = messages[start];
    if (message && opensTurn(message)) {
      opened++;
    }
  }
  return {
    hasOlder: start > 0,
    messages: messages.slice(start, upTo).flatMap((message) => {
      const light = transcriptMessage(message, { isDeveloperMode });
      return light ? [light] : [];
    }),
  };
}

/**
 * Keeps what a reader was last sent of a session, and says what moved in
 * messages that changed. Holds only those messages' light forms, so following
 * a session costs what its changes cost.
 */
export class TranscriptProjection {
  private readonly sent = new Map<StoreId.Message, TranscriptMessage>();

  constructor(private readonly isDeveloperMode: boolean) {}

  /** The first thing a reader is sent. */
  reset(messages: readonly SessionMessage.WithParts[]): TranscriptFeedEvent {
    const feed = lastTurnsOf(messages, {
      isDeveloperMode: this.isDeveloperMode,
    });
    this.sent.clear();
    for (const message of feed.messages) {
      this.sent.set(message.id, message);
    }
    return { kind: "reset", ...feed };
  }

  /**
   * What moved, given what `touched` holds now (`changed`) and which are gone.
   * Nothing when none of it shows.
   */
  update({
    changed,
    removed,
  }: {
    changed: readonly SessionMessage.WithParts[];
    removed: readonly StoreId.Message[];
  }): TranscriptFeedEvent | undefined {
    const patches: PartPatch[] = [];
    const upserted: TranscriptMessage[] = [];
    for (const message of changed) {
      const next = transcriptMessage(message, {
        isDeveloperMode: this.isDeveloperMode,
      });
      if (!next) {
        continue;
      }
      const moved = whatMoved(this.sent.get(next.id), next);
      if (moved === "whole") {
        upserted.push(next);
      } else {
        patches.push(...moved);
      }
      this.sent.set(next.id, next);
    }
    for (const id of removed) {
      this.sent.delete(id);
    }
    return upserted.length === 0 && patches.length === 0 && removed.length === 0
      ? undefined
      : { kind: "change", patches, removed: [...removed], upserted };
  }
}

/** The patches from one message to the next, or `whole` where patches cannot say it. */
function whatMoved(
  previous: TranscriptMessage | undefined,
  next: TranscriptMessage,
): "whole" | PartPatch[] {
  if (
    !previous ||
    previous.parts.length > next.parts.length ||
    !isEqual(previous.metadata, next.metadata)
  ) {
    return "whole";
  }
  const patches: PartPatch[] = [];
  for (const [index, part] of next.parts.entries()) {
    const before = previous.parts[index];
    if (before && before.metadata.id !== part.metadata.id) {
      return "whole";
    }
    if (before === undefined) {
      patches.push({ kind: "part", messageId: next.id, part });
    } else if (
      before.type === "text" &&
      part.type === "text" &&
      before.state === part.state &&
      part.text.startsWith(before.text)
    ) {
      if (part.text.length > before.text.length) {
        patches.push({
          kind: "append",
          messageId: next.id,
          partId: part.metadata.id,
          text: part.text.slice(before.text.length),
        });
      }
    } else if (!isEqual(before, part)) {
      patches.push({ kind: "part", messageId: next.id, part });
    }
  }
  return patches;
}

/**
 * Applies what the feed sent to what the reader holds. A message and part that
 * did not move stay the same objects, so what is drawn from them need not be
 * drawn again.
 */
export function applyFeedEvent(
  current: TranscriptFeed | undefined,
  event: TranscriptFeedEvent,
): TranscriptFeed {
  if (event.kind === "reset") {
    return { hasOlder: event.hasOlder, messages: event.messages };
  }
  const removed = new Set(event.removed);
  const upserts = new Map(
    event.upserted.map((message) => [message.id, message]),
  );
  const patchesOf = new Map<StoreId.Message, PartPatch[]>();
  for (const patch of event.patches) {
    patchesOf.set(patch.messageId, [
      ...(patchesOf.get(patch.messageId) ?? []),
      patch,
    ]);
  }
  const first = current?.messages[0]?.id;
  const messages: TranscriptMessage[] = (current?.messages ?? []).flatMap(
    (message) => {
      if (removed.has(message.id)) {
        return [];
      }
      const whole = upserts.get(message.id);
      upserts.delete(message.id);
      const patches = patchesOf.get(message.id);
      return [whole ?? (patches ? patched(message, patches) : message)];
    },
  );
  // New messages arrive in id order, which is the session's order. One above
  // what the reader holds is an earlier page it has not asked for.
  for (const message of upserts.values()) {
    if (first !== undefined && message.id < first) {
      continue;
    }
    const at = messages.findIndex((other) => other.id > message.id);
    if (at === -1) {
      messages.push(message);
    } else {
      messages.splice(at, 0, message);
    }
  }
  return { hasOlder: current?.hasOlder ?? false, messages };
}

/** Earlier turns, put above what the reader holds. */
export function applyOlder(
  current: TranscriptFeed | undefined,
  older: TranscriptFeed,
): TranscriptFeed {
  return {
    hasOlder: older.hasOlder,
    messages: [...older.messages, ...(current?.messages ?? [])],
  };
}

function patched(
  message: TranscriptMessage,
  patches: readonly PartPatch[],
): TranscriptMessage {
  const parts = [...message.parts];
  for (const patch of patches) {
    if (patch.kind === "part") {
      // A call a card reads whole is a step and its part, under one id.
      const at = parts.findIndex(
        (part) =>
          part.metadata.id === patch.part.metadata.id &&
          part.type === patch.part.type,
      );
      if (at === -1) {
        parts.push(patch.part);
      } else {
        parts[at] = patch.part;
      }
    } else {
      const at = parts.findIndex((part) => part.metadata.id === patch.partId);
      const part = parts[at];
      if (part?.type === "text") {
        parts[at] = { ...part, text: part.text + patch.text };
      }
    }
  }
  return { ...message, parts };
}
