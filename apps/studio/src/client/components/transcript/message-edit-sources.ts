import {
  MESSAGE_FENCE,
  parseMessage,
  type StoreId,
  type Turn,
} from "@instrument-org/workspace/client";
import { createContext } from "react";

import { type EditSource } from "../reply-blocks/message-edits";
import { normalizeReplyBlocks } from "../reply-blocks/normalize-reply-blocks";

/**
 * The text earlier in the chat that a message a turn's reply wrote may be a
 * new version of, newest first (`findMessageEdit`). Absent outside a
 * transcript's turn, and in a turn whose replies wrote no message.
 */
export const MessageEditSourcesContext = createContext<
  readonly EditSource[] | undefined
>(undefined);

/** What a turn adds to the sources of the turns after it. */
interface TurnSources {
  /** The messages its replies wrote, oldest first. */
  drafts: EditSource[];
  person?: EditSource;
}

// A turn keeps its object while its messages do (`turnsOf`), so only the one
// still arriving is read again.
const sourcesByTurn = new WeakMap<Turn, TurnSources>();

function turnSources(turn: Turn): TurnSources {
  const known = sourcesByTurn.get(turn);
  if (known) {
    return known;
  }
  const said = turn.opener?.text?.text.trim();
  const found: TurnSources = {
    drafts: turn.replies.flatMap((reply) =>
      reply.parts.flatMap((part) =>
        part.type === "text" ? draftsIn(part.text) : [],
      ),
    ),
    ...(said && { person: { from: "person", text: said } }),
  };
  sourcesByTurn.set(turn, found);
  return found;
}

/** The messages a reply's text wrote, however it wrapped them. */
function draftsIn(text: string): EditSource[] {
  if (!/message/i.test(text)) {
    return [];
  }
  return [...normalizeReplyBlocks(text).matchAll(MESSAGE_FENCE)].flatMap(
    (match) => {
      const { body, subject } = parseMessage(match.groups?.body ?? "");
      return body
        ? [{ from: "draft" as const, text: body, ...(subject && { subject }) }]
        : [];
    },
  );
}

/**
 * The sources of each turn whose replies wrote a message: what the person
 * sent to open it, then every earlier turn's messages and what the person
 * sent, newest first. A turn whose sources read as before keeps its array, so
 * a token streaming into the last reply redraws no card.
 */
export function keptEditSources(
  kept: Map<StoreId.Message, readonly EditSource[]>,
  turns: readonly Turn[],
): Map<StoreId.Message, readonly EditSource[]> {
  const byTurn = new Map<StoreId.Message, readonly EditSource[]>();
  const earlier: EditSource[] = [];
  for (const turn of turns) {
    const { drafts, person } = turnSources(turn);
    if (person) {
      earlier.push(person);
    }
    if (drafts.length > 0) {
      const next = earlier.toReversed();
      const was = kept.get(turn.id);
      byTurn.set(turn.id, was && isSameSources(was, next) ? was : next);
    }
    earlier.push(...drafts);
  }
  kept.clear();
  for (const [key, value] of byTurn) {
    kept.set(key, value);
  }
  return byTurn;
}

function isSameSources(
  a: readonly EditSource[],
  b: readonly EditSource[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (source, index) =>
        source.from === b[index]?.from &&
        source.text === b[index]?.text &&
        source.subject === b[index]?.subject,
    )
  );
}
