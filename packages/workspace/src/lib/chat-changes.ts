import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { getTurnContext, type TurnKey, turnKey } from "./turn-context";

export type ChatChange = SessionMessageDataPart.ChatChange;

/**
 * What each turn's `chats` commands changed, by chat and session, in the
 * order first changed. A command knows what it set and what was there, so
 * nothing is compared afterward, as the setup's tracker has to.
 */
const TURNS = new Map<string, Map<string, ChatChange>>();

export function beginChatChangeTracking(turn: TurnKey): void {
  TURNS.set(turnKey(turn), new Map());
}

/**
 * Records one field of one chat the turn running now set. A second change to
 * the same field keeps the value from before the first, so the note says
 * what the turn did as a whole and Undo goes back to before it.
 */
export function recordChatChange(change: ChatChange): void {
  const context = getTurnContext();
  const changes = context && TURNS.get(turnKey(context));
  if (!changes) {
    return;
  }
  const key = `${change.chat}:${change.field}`;
  const first = changes.get(key);
  changes.set(
    key,
    first === undefined
      ? change
      : // The changes of one key are of one field, so the first's `before`
        // is of this change's kind.
        ({ ...change, before: first.before } as ChatChange),
  );
}

/** What the turn's commands changed, less what ended where it began. Ends the tracking. */
export function consumeChatChanges(turn: TurnKey): ChatChange[] {
  const key = turnKey(turn);
  const changes = TURNS.get(key);
  TURNS.delete(key);
  return [...(changes?.values() ?? [])].filter(
    (change) => change.before !== change.after,
  );
}
