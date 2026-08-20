import { type StoreId } from "@instrument-org/workspace/client";
import { useLayoutEffect, useRef } from "react";

// The scroller the transcript is drawn in, and the only thing here that scrolls.
// Absent on the surfaces that draw a transcript without one, where a row has
// nothing to be held against.
const VIEWPORT = "[data-slot=message-scroller-viewport]";

/** Where a row's line sat, and what it sat in; see `useHoldRowInPlace`. */
interface RowPlacement {
  rowId: StoreId.Part;
  /** Down from the top of the scroller, in on-screen px. */
  top: number;
  viewport: HTMLElement;
}

/**
 * Marks a row's own line, so it can be found again once it has moved.
 *
 * An attribute rather than a ref because the row that moves is not the element
 * that moved: a step is drawn as the copy in a working group's slot and again in
 * its place in the run, and opening it swaps the one for the other. See
 * `TranscriptExpansion`, which holds the open state for the same reason.
 */
export function transcriptRowAttributes(rowId: StoreId.Part | undefined) {
  return { "data-transcript-row": rowId };
}

/**
 * Keeps a row the reader opened where they clicked it.
 *
 * Opening a step opens the phase around it, and the phase's other steps are
 * drawn between the top of that phase and the step itself -- so the row lands
 * however many rows lower than the copy the reader clicked, which while the
 * agent is working is usually off the bottom of the screen. Nothing brings it
 * back: the click released follow, exactly so that opening a row would not drag
 * the transcript to its live end.
 *
 * Measured before the click's render and corrected after it, which leaves the
 * row under the pointer and the phase unfolding above it.
 *
 * The measurement is a ref rather than state, and the correction runs after
 * every commit and takes it if it is there. What opens a row also renders the
 * transcript, so the commit that consumes it is the one that moved the row; the
 * value cannot outlive the click, and a correction against an unmoved row is
 * zero anyway.
 */
export function useHoldRowInPlace() {
  const held = useRef<RowPlacement | undefined>(undefined);

  useLayoutEffect(() => {
    const placement = held.current;
    if (placement === undefined) {
      return;
    }
    held.current = undefined;
    restoreRowPlacement(placement);
  });

  return (rowId: StoreId.Part) => {
    held.current = readRowPlacement(rowId);
  };
}

function readRowPlacement(rowId: StoreId.Part): RowPlacement | undefined {
  const line = rowLine(rowId);
  const viewport = line?.closest<HTMLElement>(VIEWPORT);
  if (!line || !viewport) {
    return undefined;
  }
  return {
    rowId,
    top:
      line.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
    viewport,
  };
}

function restoreRowPlacement({ rowId, top, viewport }: RowPlacement) {
  const line = rowLine(rowId);
  if (!line) {
    return;
  }

  const box = viewport.getBoundingClientRect();
  const moved = line.getBoundingClientRect().top - box.top - top;
  if (moved === 0) {
    return;
  }

  // Rects are on-screen px and `scrollTop` is layout px, and the app's zoom sits
  // between the two: at 1.5x a row that moved 300px on screen is 200px of
  // scrolling. The viewport's own height is the same measurement in each unit,
  // so the two of them are the factor. See `docs/architecture/responsive-layout.md`.
  const zoom = box.height / viewport.clientHeight;
  viewport.scrollTop +=
    Number.isFinite(zoom) && zoom > 0 ? moved / zoom : moved;
}

function rowLine(rowId: StoreId.Part) {
  // Matched off the dataset rather than by putting the id in the selector, so
  // nothing here depends on a part id being safe to write into one.
  //
  // The last match, which is the row in its place in the run: a group draws its
  // copy in the slice it opened in, so a copy is always above the row it copies.
  return [
    ...document.querySelectorAll<HTMLElement>("[data-transcript-row]"),
  ].findLast((line) => line.dataset.transcriptRow === rowId);
}
