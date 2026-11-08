import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import {
  type ChatId,
  type ChatListEvent,
  foldChatList,
  type HeldChatList,
  type ListedAt,
} from "@instrument-org/workspace/client";

import { type Chat } from "./chats";

/**
 * What a window paints onto a chat's row from a click, ahead of the request:
 * fields of the row (a field set to `undefined` takes it off), or the row
 * gone.
 */
export type ChatRowChange = Partial<Chat> | "gone";

/** One paint, from the click until the list the window holds shows it. */
export interface ChatRowPaint {
  change: ChatRowChange;
  id: ChatId;
  /** Where the list stands once the request is in it, from the request's answer. */
  landed?: ListedAt;
}

/**
 * What a window holds of the chat list: the rows as the workspace last sent
 * them, the paints over them, oldest first, and the rows last shown.
 */
export interface ChatListState {
  held?: HeldChatList<Chat>;
  paints: ChatRowPaint[];
  shown?: Chat[];
}

export function emptyChatListState(): ChatListState {
  return { paints: [] };
}

/**
 * Takes in what the list sent, and says whether it went on from what the
 * window holds; when it did not, the list has to be read again from the
 * start. A row that did not change keeps its object, a row sent again
 * unchanged included, so what is drawn from it is not drawn again. A paint
 * whose request the list now has in it goes.
 */
export function takeChatListEvent(
  state: ChatListState,
  event: ChatListEvent<Chat>,
): boolean {
  const held = foldChatList(state.held, event, shareEqualDeep);
  if (!held) {
    return false;
  }
  state.held = held;
  dropReached(state);
  return true;
}

/** Paints `change` onto a row until the request it stands for has answered. */
export function addPaint(
  state: ChatListState,
  id: ChatId,
  change: ChatRowChange,
): ChatRowPaint {
  const paint = { change, id };
  state.paints.push(paint);
  return paint;
}

/**
 * The request a paint stands for answered with where the list stands once
 * it is in it: the paint stays until the list the window holds is there,
 * and goes at once when there is no list to wait for.
 */
export function landPaint(
  state: ChatListState,
  paint: ChatRowPaint,
  at: ListedAt | null,
) {
  if (!at) {
    dropPaint(state, paint);
    return;
  }
  paint.landed = at;
  dropReached(state);
}

/** Takes a paint back: its request failed. */
export function dropPaint(state: ChatListState, paint: ChatRowPaint) {
  state.paints = state.paints.filter((each) => each !== paint);
}

/**
 * Drops each paint the held list has caught up with: one whose list is at
 * or past its revision, or one from another run of the list, which a fresh
 * snapshot replaced and so took the request in with everything else.
 */
function dropReached(state: ChatListState) {
  const { held } = state;
  if (!held) {
    return;
  }
  state.paints = state.paints.filter(
    ({ landed }) =>
      !landed || (landed.epoch === held.epoch && landed.rev > held.rev),
  );
}

/**
 * The rows a window shows: what it holds with every paint over it, the
 * newest last. A row no paint moved is the object held for it, and a
 * painted row that comes out as it was last shown keeps that object.
 */
export function shownChats(state: ChatListState): Chat[] | undefined {
  const rows = state.held?.rows;
  if (!rows) {
    return undefined;
  }
  const painted = new Map<ChatId, ChatRowChange[]>();
  for (const { change, id } of state.paints) {
    painted.set(id, [...(painted.get(id) ?? []), change]);
  }
  const merged =
    painted.size === 0
      ? rows
      : rows.flatMap((row) => {
          const changes = painted.get(row.id);
          if (!changes) {
            return [row];
          }
          if (changes.includes("gone")) {
            return [];
          }
          const next: Record<string, unknown> = { ...row };
          for (const change of changes) {
            for (const [key, value] of Object.entries(change)) {
              if (value === undefined) {
                delete next[key];
              } else {
                next[key] = value;
              }
            }
          }
          // The row's own fields, some replaced and some taken off.
          return [next as Chat];
        });
  state.shown = shareChatList(state.shown, merged);
  return state.shown;
}

/**
 * `shareEqualDeep` for what is read from the chat list, except that a list
 * of chats is shared by each chat's id rather than by its place: with a chat
 * gone or come, every chat after it is still the object it was, rather than
 * one compared against its neighbor's and made new.
 */
export function shareChatList<T>(previous: unknown, next: T): T {
  const rows = withIds(next);
  const was = withIds(previous);
  if (!rows || !was) {
    return shareEqualDeep(previous, next);
  }
  const before = new Map(was.map((item) => [item.id, item]));
  let same = was.length === rows.length;
  const shared = rows.map((item, index) => {
    const kept = shareEqualDeep(before.get(item.id), item);
    same &&= kept === was[index];
    return kept;
  });
  // Either is `next` item for item, with equal items swapped for the ones
  // they equal, which the array's own type cannot say.
  return (same ? previous : shared) as T;
}

/** A list whose every item has an id, or none for anything else. */
function withIds(value: unknown): { id: string }[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: unknown[] = value;
  return items.every(hasId) ? items : undefined;
}

function hasId(item: unknown): item is { id: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    typeof item.id === "string"
  );
}
