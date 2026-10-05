import {
  composeAtom,
  type ComposeEntry,
  composeKeyOf,
  type ComposePlacement,
  draftGroupOf,
  type ScreenView,
} from "@/client/atoms/window";
import { zoomAtom } from "@/client/atoms/zoom";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";

import { type ComposeHost, type PageChromeSlots } from "./browser-tabs";
import { COMPOSE_GUEST_LAYER, layoutCompose } from "./compose-layout";

/**
 * The windows along the foot of the row: the drafts being written and the
 * chats in their small views, laid out, with what each draft window's page
 * is drawn into and what each has on screen, for the layout that draws the
 * windows over the pane's page and starts the chats the drafts become. Everything is keyed by the group the window shows: the
 * draft's key, or the chat's id.
 */
/** A tab a chat's small view peeks at, and where its page is drawn. */
export interface ComposePeek {
  chrome: PageChromeSlots | undefined;
  into: HTMLElement | null;
  tabId: string;
}

export function useCompose(width: number) {
  const [entries, setEntries] = useAtom(composeAtom);
  // Where each window's page is drawn, by the window's group, once the
  // window has made the element (a draft's band, or a chat grown to fill
  // the row); and what each draft window's band has up.
  const [hostsById, setHostsById] = useState<
    Record<string, HTMLElement | null>
  >({});
  const [viewsById, setViewsById] = useState<Record<string, null | ScreenView>>(
    {},
  );
  // Where each window's address row takes its page's reload and controls,
  // while a page is up under it.
  const [chromeById, setChromeById] = useState<
    Record<string, PageChromeSlots | undefined>
  >({});
  // What each chat's small view is peeking at, while it is: the tab, the
  // element its page is drawn into, and where the peek's row takes the
  // page's reload and controls. In memory only: a peek is a look, and the
  // tab the chat has up is not moved by it.
  const [peeksById, setPeeksById] = useState<
    Record<string, ComposePeek | undefined>
  >({});
  const zoom = useAtomValue(zoomAtom);
  const placed = layoutCompose(entries, width, zoom);
  const windows = placed.filter((entry) => entry.placement !== "bar");
  // A chat's small view draws only the page it peeks at; grown to fill
  // the row it draws the page it has up.
  const hosts: ComposeHost[] = windows.flatMap((entry): ComposeHost[] => {
    const key = composeKeyOf(entry);
    if (entry.kind === "draft" || entry.placement === "expanded") {
      return [
        {
          chrome: chromeById[key] ?? true,
          group: key,
          into: hostsById[key] ?? null,
          isActive: true,
          layer: COMPOSE_GUEST_LAYER,
          place: `${entry.placement}:${entry.right}:${entry.width ?? ""}`,
        },
      ];
    }
    const peek = peeksById[key];
    return peek
      ? [
          {
            chrome: peek.chrome ?? false,
            group: key,
            into: peek.into,
            isActive: true,
            layer: COMPOSE_GUEST_LAYER,
            place: `peek:${entry.right}:${entry.width ?? ""}`,
            tabId: peek.tabId,
          },
        ]
      : [];
  });

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
  /** Drops what was kept for a window's group: where its page was drawn and what it had up. */
  const forget = (key: string) => {
    setHostsById((current) => {
      const { [key]: _gone, ...rest } = current;
      return rest;
    });
    setViewsById((current) => {
      const { [key]: _gone, ...rest } = current;
      return rest;
    });
    setChromeById((current) => {
      const { [key]: _gone, ...rest } = current;
      return rest;
    });
    setPeeksById((current) => {
      const { [key]: _gone, ...rest } = current;
      return rest;
    });
  };
  /**
   * The draft's window becomes the chat's small view in the same place
   * along the foot: the entry is replaced where it stands, put down if the
   * draft was, docked if it had grown, since a chat's view has no larger
   * size. What the draft's band drew and reported goes with the draft.
   */
  const becomeChat = (draftId: string, chatId: ChatId) => {
    const key = draftGroupOf(draftId);
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
    forget(key);
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
    forget(key);
  };
  const setHost = (key: string, element: HTMLElement | null) => {
    setHostsById((current) =>
      current[key] === element ? current : { ...current, [key]: element },
    );
  };
  const setChrome = (key: string, slots: PageChromeSlots | undefined) => {
    setChromeById((current) =>
      current[key]?.into === slots?.into &&
      current[key]?.reloadInto === slots?.reloadInto
        ? current
        : { ...current, [key]: slots },
    );
  };
  /** What a chat's small view peeks at, or that it peeks at nothing. */
  const setPeek = (key: string, peek: ComposePeek | undefined) => {
    setPeeksById((current) => {
      const was = current[key];
      return was?.tabId === peek?.tabId &&
        was?.into === peek?.into &&
        was?.chrome?.into === peek?.chrome?.into &&
        was?.chrome?.reloadInto === peek?.chrome?.reloadInto
        ? current
        : { ...current, [key]: peek };
    });
  };
  const setView = (key: string, view: null | ScreenView) => {
    // By value: a window reports the same view again as it re-renders, and
    // a fresh object each time would re-render the layout on every report.
    setViewsById((current) =>
      JSON.stringify(current[key] ?? null) === JSON.stringify(view)
        ? current
        : { ...current, [key]: view },
    );
  };

  return {
    becomeChat,
    becomeDraft,
    entries,
    float,
    hosts,
    open,
    placed,
    remove,
    setChrome,
    setHost,
    setPeek,
    setPlacement,
    setView,
    viewsById,
  };
}
