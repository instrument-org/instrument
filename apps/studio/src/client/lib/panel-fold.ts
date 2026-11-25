/**
 * Whether a panel kept beside what a person reads shows, the way a Mac's
 * sidebar does: Files' folder beside a file, a Markdown file's outline
 * beside its text. The person keeps it or puts it away; while they keep it,
 * a layout too narrow for it folds it away, and it comes back once the
 * layout has the room again.
 */
export interface PanelFold {
  /** The person's choice: kept unless they put it away. */
  isWanted: boolean;
  /** The width's verdict: whether the layout has room for the panel. */
  hasRoom: boolean;
  /** Shown by hand while the layout had no room, until the width's verdict next changes. */
  isShownAnyway: boolean;
}

/** A panel as it opens: kept, and shown wherever the layout has room. */
export const KEPT_PANEL: PanelFold = {
  hasRoom: true,
  isShownAnyway: false,
  isWanted: true,
};

/**
 * How much wider than where it folded, in layout px, a layout grows before
 * the panel comes back, so a divider dragged back and forth across the line
 * does not fold and unfold it at every step.
 */
const UNFOLD_MARGIN = 40;

export function showsPanel(fold: PanelFold) {
  return fold.isWanted && (fold.hasRoom || fold.isShownAnyway);
}

/**
 * The fold at a layout `width` wide, where `hasRoomAt` says whether a layout
 * that wide has room for the panel. With room, it folds once the layout has
 * none; without, it waits for room `UNFOLD_MARGIN` past that. A verdict that
 * changes ends a panel shown by hand; the same verdict returns the same fold.
 */
export function foldToWidth(
  fold: PanelFold,
  width: number,
  hasRoomAt: (width: number) => boolean,
): PanelFold {
  const hasRoom = hasRoomAt(fold.hasRoom ? width : width - UNFOLD_MARGIN);
  return hasRoom === fold.hasRoom
    ? fold
    : { ...fold, hasRoom, isShownAnyway: false };
}

/** The person's toggle: a shown panel is put away at every width; a hidden one shows. */
export function togglePanel(fold: PanelFold): PanelFold {
  return showsPanel(fold) ? hidePanel(fold) : showPanel(fold);
}

/** The person asked for the panel: shown, where the layout has no room for it too. */
export function showPanel(fold: PanelFold): PanelFold {
  return { ...fold, isShownAnyway: !fold.hasRoom, isWanted: true };
}

/** The person put the panel away: hidden at every width until shown again. */
export function hidePanel(fold: PanelFold): PanelFold {
  return { ...fold, isShownAnyway: false, isWanted: false };
}
