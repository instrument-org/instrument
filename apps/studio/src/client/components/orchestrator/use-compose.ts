import {
  composeAtom,
  type ComposeEntry,
  composeKeyOf,
  type ComposePlacement,
  draftGroupOf,
  type ScreenView,
} from "@/client/atoms/orchestrator";
import { zoomAtom } from "@/client/atoms/zoom";
import { type StoreId } from "@instrument-org/workspace/client";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";

import { type ComposeHost, type PageChromeSlots } from "./browser-tabs";
import { COMPOSE_GUEST_LAYER, layoutCompose } from "./compose-layout";

/**
 * The windows along the foot of the row: the drafts being written and the
 * threads in their small views, laid out, with what each draft window's page
 * is drawn into and what each has on screen, for the layout that draws the
 * windows over the pane's page and starts the threads the drafts become. Everything is keyed by the group the window shows: the
 * draft's key, or the thread's session.
 */
export function useCompose(
  width: number,
  /** Whether a thread's group holds anything, which gives its small view a rail. */
  holdsAnything: (group: string) => boolean,
) {
  const [entries, setEntries] = useAtom(composeAtom);
  // Where each window's page is drawn, by the window's group, once the
  // window has made the element (a draft's band, or a thread grown to fill
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
  const zoom = useAtomValue(zoomAtom);
  const placed = layoutCompose(
    entries,
    width,
    (entry) => entry.kind === "thread" && holdsAnything(entry.sessionId),
    zoom,
  );
  const windows = placed.filter((entry) => entry.placement !== "bar");
  // A thread's small view draws no page; grown to fill the row it does.
  const hosts: ComposeHost[] = windows.flatMap((entry) =>
    entry.kind === "draft" || entry.placement === "expanded"
      ? [
          {
            chrome: chromeById[composeKeyOf(entry)] ?? true,
            group: composeKeyOf(entry),
            into: hostsById[composeKeyOf(entry)] ?? null,
            isActive: true,
            layer: COMPOSE_GUEST_LAYER,
            place: `${entry.placement}:${entry.right}:${entry.width ?? ""}`,
          },
        ]
      : [],
  );

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
  /** Floats a thread in its small view: a new window at the right, or the bar it was put down to, raised. */
  const float = (sessionId: StoreId.Session) => {
    raise(sessionId, () => ({
      kind: "thread",
      placement: "docked",
      sessionId,
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
  };
  /**
   * The draft's window becomes the thread's small view in the same place
   * along the foot: the entry is replaced where it stands, put down if the
   * draft was, docked if it had grown, since a thread's view has no larger
   * size. What the draft's band drew and reported goes with the draft.
   */
  const becomeThread = (draftId: string, sessionId: StoreId.Session) => {
    const key = draftGroupOf(draftId);
    setEntries((current) =>
      current.map((entry) =>
        entry.kind === "draft" && entry.draftId === draftId
          ? {
              fromDraft: draftId,
              kind: "thread",
              placement: entry.placement === "bar" ? "bar" : "docked",
              sessionId,
            }
          : entry,
      ),
    );
    forget(key);
  };
  /**
   * The thread's small view goes back to being the draft's window in the
   * same place, for a thread that never started: the draft comes back up
   * with what its window was given still in it.
   */
  const becomeDraft = (sessionId: StoreId.Session, draftId: string) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.kind === "thread" && entry.sessionId === sessionId
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
    becomeDraft,
    becomeThread,
    entries,
    float,
    hosts,
    open,
    placed,
    remove,
    setChrome,
    setHost,
    setPlacement,
    setView,
    viewsById,
  };
}
