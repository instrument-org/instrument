import {
  composeAtom,
  type ComposePlacement,
  draftGroupOf,
  type ScreenView,
} from "@/client/atoms/orchestrator";
import { useAtom } from "jotai";
import { useState } from "react";

import { type ComposeHost } from "./browser-tabs";
import { layoutCompose } from "./compose-layout";

/**
 * The drafts being written, laid along the foot of the row, with what each
 * window's page is drawn into and what each has on screen, for the layout
 * that draws the windows, parks the pane's guest under them, and starts the
 * threads they become.
 */
export function useCompose(width: number) {
  const [entries, setEntries] = useAtom(composeAtom);
  // Where each window's page is drawn, by draft id, once the window has
  // made the element; and what each window's band has up.
  const [hostsById, setHostsById] = useState<
    Record<string, HTMLElement | null>
  >({});
  const [viewsById, setViewsById] = useState<Record<string, null | ScreenView>>(
    {},
  );
  const placed = layoutCompose(entries, width);
  const windows = placed.filter((entry) => entry.placement !== "bar");
  const hosts: ComposeHost[] = windows.map((entry) => ({
    group: draftGroupOf(entry.draftId),
    into: hostsById[entry.draftId] ?? null,
    isActive: true,
    place: `${entry.placement}:${entry.right}`,
  }));

  /** Brings a draft up in a window: a new window at the right, or the bar it was put down to, raised. */
  const open = (draftId: string) => {
    setEntries((current) =>
      current.some((entry) => entry.draftId === draftId)
        ? current.map((entry) =>
            entry.draftId === draftId && entry.placement === "bar"
              ? { ...entry, placement: "docked" }
              : entry,
          )
        : [...current, { draftId, placement: "docked" }],
    );
  };
  const setPlacement = (draftId: string, placement: ComposePlacement) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.draftId === draftId ? { ...entry, placement } : entry,
      ),
    );
  };
  /** Takes a draft's window down, whatever became of the draft. */
  const remove = (draftId: string) => {
    setEntries((current) =>
      current.filter((entry) => entry.draftId !== draftId),
    );
    setHostsById((current) => {
      const { [draftId]: _gone, ...rest } = current;
      return rest;
    });
    setViewsById((current) => {
      const { [draftId]: _gone, ...rest } = current;
      return rest;
    });
  };
  const setHost = (draftId: string, element: HTMLElement | null) => {
    setHostsById((current) =>
      current[draftId] === element
        ? current
        : { ...current, [draftId]: element },
    );
  };
  const setView = (draftId: string, view: null | ScreenView) => {
    // By value: a window reports the same view again as it re-renders, and
    // a fresh object each time would re-render the layout on every report.
    setViewsById((current) =>
      JSON.stringify(current[draftId] ?? null) === JSON.stringify(view)
        ? current
        : { ...current, [draftId]: view },
    );
  };

  return {
    /** Whether a window stands over the row, which is when the pane's guest has to park under it. */
    covers: windows.length > 0,
    entries,
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
