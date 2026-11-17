/**
 * The rules a transcript's scroll position follows, as plain functions of what
 * was measured, so every position the scroller writes is one these chose.
 *
 * The scroller is in one of three modes:
 *
 * - `follow`: held at the end while something can arrive there.
 * - `anchor`: a message just sent held near the top, with room under it for
 *   the reply. Once the reply has filled that room and still grows, the
 *   scroller follows its end.
 * - `keep`: the reader is where they put themselves, and the scroller leaves
 *   them there.
 *
 * Only the reader's own input, a send, or a command moves between them. A
 * scroll position going down is never read as the reader scrolling, since the
 * browser lowers it on its own as it lays out.
 */

export type ScrollMode =
  | { kind: "follow" }
  | {
      kind: "anchor";
      /** The anchored message's id, or a key for it when it has none. */
      key: string;
      /** How tall the content was when the message was anchored, spacer aside. */
      contentAtAnchor: number;
    }
  | { kind: "keep" };

/** What the scroller measured this frame, in layout px. */
export interface ScrollGeometry {
  /** The anchored message's top, in the viewport's scroll coordinates. */
  anchorTop?: number;
  /** Where the content ends, spacer aside, in scroll coordinates. */
  contentBottom: number;
  scrollTop: number;
  /** The room under the content the scroller added, as it stands. */
  spacer: number;
  /** The content's own room above its first row, kept above an anchored message too. */
  topInset?: number;
  viewportHeight: number;
}

export interface ScrollSettings {
  /** Whether anything can still arrive at the end, so following it moves anything. */
  autoScroll: boolean;
  /** Room left above an anchored message, so the end of what came before shows. */
  anchorRoom: number;
}

export interface ScrollWrite {
  mode: ScrollMode;
  /** The position to write, or none to leave it where it is. */
  scrollTop?: number;
  spacer: number;
}

/** How close to an edge counts as at it, for the jump button and the fades. */
const EDGE_THRESHOLD = 8;

/** Closer than this is the same position, rounding aside. */
export const SAME_POSITION = 1;

/** The furthest the viewport can scroll with no spacer under the content. */
export function endOf(geometry: ScrollGeometry): number {
  return Math.max(0, geometry.contentBottom - geometry.viewportHeight);
}

/**
 * The one write for this frame: where the scroll position goes, how much room
 * the spacer leaves, and the mode it leaves the scroller in.
 */
export function settle(
  mode: ScrollMode,
  geometry: ScrollGeometry,
  settings: ScrollSettings,
): ScrollWrite {
  switch (mode.kind) {
    case "follow": {
      return settings.autoScroll
        ? { mode, scrollTop: endOf(geometry), spacer: 0 }
        : { mode, spacer: 0 };
    }
    case "anchor": {
      if (geometry.anchorTop === undefined) {
        return { mode: { kind: "keep" }, spacer: keptSpacer(geometry) };
      }
      const target = Math.max(
        0,
        geometry.anchorTop - settings.anchorRoom - (geometry.topInset ?? 0),
      );
      const needed = Math.max(
        0,
        target + geometry.viewportHeight - geometry.contentBottom,
      );
      // The reply has filled the room under the message and is still growing:
      // from here the end is what is new.
      if (
        settings.autoScroll &&
        needed === 0 &&
        geometry.contentBottom > mode.contentAtAnchor
      ) {
        return {
          mode: { kind: "follow" },
          scrollTop: endOf(geometry),
          spacer: 0,
        };
      }
      return { mode, scrollTop: target, spacer: needed };
    }
    case "keep": {
      return { mode, spacer: keptSpacer(geometry) };
    }
  }
}

/**
 * The spacer a reader who took over keeps: only as much as their position still
 * needs, so it shrinks as the reply grows into it or the reader scrolls up, and
 * never grows.
 */
function keptSpacer(geometry: ScrollGeometry): number {
  const needed =
    geometry.scrollTop + geometry.viewportHeight - geometry.contentBottom;
  return Math.max(0, Math.min(geometry.spacer, Math.ceil(needed)));
}

/** Whether there is anything to scroll to at either edge, as the controls show it. */
export function scrollableOf(
  mode: ScrollMode,
  geometry: ScrollGeometry,
  settings: ScrollSettings,
): { end: boolean; start: boolean } {
  const below =
    geometry.contentBottom - (geometry.scrollTop + geometry.viewportHeight);
  // While following, the gap a chunk opens closes in the same frame, so it
  // is never published, or the jump button would blink once per chunk.
  const isHeld =
    settings.autoScroll && (mode.kind === "follow" || mode.kind === "anchor");
  return {
    end: !isHeld && below > EDGE_THRESHOLD,
    start: geometry.scrollTop > EDGE_THRESHOLD,
  };
}

/** Whether the reader is at the end, where scrolling there by hand resumes following. */
export function isAtEnd(geometry: ScrollGeometry): boolean {
  return (
    geometry.contentBottom - (geometry.scrollTop + geometry.viewportHeight) <=
    EDGE_THRESHOLD
  );
}
