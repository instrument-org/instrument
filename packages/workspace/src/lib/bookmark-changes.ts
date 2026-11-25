import { isEqual, omit } from "radashi";

import {
  type BookmarkChange,
  type BookmarkSide,
} from "../schemas/bookmark-change";
import { getTurnContext, type TurnKey, turnKey } from "./turn-context";

/** What each turn's `bookmarks` commands changed, by chat and session, then by bookmark or folder. */
const TURNS = new Map<string, Map<string, BookmarkChange>>();

export function beginBookmarkChangeTracking(turn: TurnKey): void {
  TURNS.set(turnKey(turn), new Map());
}

/** The changes of the turn running now, or none where no turn is, and so no card would show them. */
function changesNow(): Map<string, BookmarkChange> | undefined {
  const context = getTurnContext();
  return context && TURNS.get(turnKey(context));
}

/** Whether a change made now is shown on the turn's card, with Undo. */
export function bookmarkChangesAreShown(): boolean {
  return changesNow() !== undefined;
}

/** Whether a bookmark stood alike on both sides; the words for its place follow a folder's name, which is the folder's change. */
function sameSide(a: BookmarkSide | null, b: BookmarkSide | null): boolean {
  return a === null || b === null
    ? a === b
    : isEqual(omit(a, ["place"]), omit(b, ["place"]));
}

/**
 * Records what the turn running now changed. A second change to the same
 * bookmark keeps how it stood before the first, so the card says what the
 * turn did as a whole and Undo goes back to before it, unless the person
 * changed it in between, whose change Undo goes back to.
 */
export function recordBookmarkChanges(made: readonly BookmarkChange[]): void {
  const changes = changesNow();
  if (!changes) {
    return;
  }
  for (const change of made) {
    const first = changes.get(change.id);
    changes.set(change.id, {
      ...change,
      before:
        first && sameSide(first.after, change.before)
          ? first.before
          : change.before,
    });
  }
}

/** What the turn's commands changed, less what ended where it began. Ends the tracking. */
export function consumeBookmarkChanges(turn: TurnKey): BookmarkChange[] {
  const key = turnKey(turn);
  const changes = TURNS.get(key);
  TURNS.delete(key);
  return [...(changes?.values() ?? [])].filter(
    (change) => !sameSide(change.before, change.after),
  );
}
