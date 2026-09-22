import {
  composeAtom,
  type ComposeEntry,
  composeKeyOf,
  type ComposePlacement,
  draftGroupOf,
  type ScreenView,
} from "@/client/atoms/orchestrator";
import { type StoreId } from "@instrument-org/workspace/client";
import { useAtom } from "jotai";
import { useState } from "react";

import { type ComposeHost } from "./browser-tabs";
import { COMPOSE_GUEST_LAYER, layoutCompose } from "./compose-layout";

/**
 * The windows along the foot of the row: the drafts being written and the
 * threads in their small views, laid out, with what each draft window's page
 * is drawn into and what each has on screen, for the layout that draws the
 * windows over the pane's page and starts the threads the drafts become. Everything is keyed by the group the window shows: the
 * draft's key, or the thread's session.
 */
export function useCompose(width: number) {
  const [entries, setEntries] = useAtom(composeAtom);
  // Where each draft window's page is drawn, by the draft's group, once the
  // window has made the element; and what each draft window's band has up.
  // A thread's small view draws no page and reports no view.
  const [hostsById, setHostsById] = useState<
    Record<string, HTMLElement | null>
  >({});
  const [viewsById, setViewsById] = useState<Record<string, null | ScreenView>>(
    {},
  );
  const placed = layoutCompose(entries, width);
  const windows = placed.filter((entry) => entry.placement !== "bar");
  const hosts: ComposeHost[] = windows.flatMap((entry) =>
    entry.kind === "draft"
      ? [
          {
            group: draftGroupOf(entry.draftId),
            into: hostsById[draftGroupOf(entry.draftId)] ?? null,
            isActive: true,
            layer: COMPOSE_GUEST_LAYER,
            place: `${entry.placement}:${entry.right}`,
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
    becomeThread,
    entries,
    float,
    hosts,
    open,
    placed,
    remove,
    setHost,
    setPlacement,
    setView,
    viewsById,
  };
}
