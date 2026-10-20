import { draftGroupOf } from "@/shared/drafts";
import {
  composeAtom,
  type ComposeEntry,
  composeKeyOf,
  type ComposePlacement,
} from "@/client/atoms/window";
import { zoomAtom } from "@/client/atoms/zoom";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtom, useAtomValue } from "jotai";

import { layoutCompose } from "./compose-layout";

/**
 * The windows along the foot of the row: the drafts being written and the
 * chats in their small views, laid out, for the layout that draws the
 * windows over the pane's page and starts the chats the drafts become.
 * Everything is keyed by the group the window shows: the draft's key, or the
 * chat's id. Where each window's page is drawn the window says itself; see
 * `usePageHost`.
 */
export function useCompose(width: number) {
  const [entries, setEntries] = useAtom(composeAtom);
  const zoom = useAtomValue(zoomAtom);
  const placed = layoutCompose(entries, width, zoom);
  /** Whether a window is standing: a new one at the right, or the bar it was put down to, raised. */
  const raise = (key: string, make: () => ComposeEntry) => {
    setEntries((current) =>
      current.some((entry) => composeKeyOf(entry) === key)
        ? current.map((entry) =>
            composeKeyOf(entry) === key && entry.placement === "bar"
              ? { ...entry, placement: "docked" }
              : entry,
          )
        : [...current, make()],
    );
  };
  /** Brings a draft up in a window: a new window at the right, or the bar it was put down to, raised. */
  const open = (draftId: string) => {
    raise(draftGroupOf(draftId), () => ({
      draftId,
      kind: "draft",
      placement: "docked",
    }));
  };
  /** Floats a chat in its small view: a new window at the right, or the bar it was put down to, raised. */
  const float = (chatId: ChatId) => {
    raise(chatId, () => ({
      chatId,
      kind: "chat",
      placement: "docked",
    }));
  };
  /**
   * The draft's window becomes the chat's small view in the same place
   * along the foot: the entry is replaced where it stands, put down if the
   * draft was, docked if it had grown, since a chat's view has no larger
   * size. What the draft's band drew and reported goes with the draft.
   */
  const becomeChat = (draftId: string, chatId: ChatId) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.kind === "draft" && entry.draftId === draftId
          ? {
              chatId,
              fromDraft: draftId,
              kind: "chat",
              placement: entry.placement === "bar" ? "bar" : "docked",
            }
          : entry,
      ),
    );
  };
  /**
   * The chat's small view goes back to being the draft's window in the
   * same place, for a chat that never started: the draft comes back up
   * with what its window was given still in it.
   */
  const becomeDraft = (chatId: ChatId, draftId: string) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.kind === "chat" && entry.chatId === chatId
          ? { draftId, kind: "draft", placement: "docked" }
          : entry,
      ),
    );
  };
  const setPlacement = (key: string, placement: ComposePlacement) => {
    setEntries((current) =>
      current.map((entry) =>
        composeKeyOf(entry) === key ? { ...entry, placement } : entry,
      ),
    );
  };
  /** Takes a window down, by its group, whatever became of what it showed. */
  const remove = (key: string) => {
    setEntries((current) =>
      current.filter((entry) => composeKeyOf(entry) !== key),
    );
  };
  return {
    becomeChat,
    becomeDraft,
    entries,
    float,
    open,
    placed,
    remove,
    setPlacement,
  };
}
