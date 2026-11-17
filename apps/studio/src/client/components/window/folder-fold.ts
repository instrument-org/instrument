/**
 * Whether the folder beside a file shows, the way a Mac's sidebar does. The
 * person keeps it or hides it; while they keep it, a tab too narrow for it
 * beside the file folds it away, and it comes back once the tab has the
 * room again.
 */
export interface FolderFold {
  /** The person's choice: kept unless they hid it. */
  isWanted: boolean;
  /** The width's verdict: whether the tab has room for the folder beside the file. */
  hasRoom: boolean;
  /** Shown by hand while the tab had no room, until the width's verdict next changes. */
  isShownAnyway: boolean;
}

/** A folder a file opens beside: kept, and shown wherever the tab has room. */
export const KEPT_FOLDER: FolderFold = {
  hasRoom: true,
  isShownAnyway: false,
  isWanted: true,
};

/**
 * How much wider than where it folded, in layout px, a tab grows before the
 * folder comes back, so a divider dragged back and forth across the line
 * does not fold and unfold it at every step.
 */
const UNFOLD_MARGIN = 40;

export function showsFolder(fold: FolderFold) {
  return fold.isWanted && (fold.hasRoom || fold.isShownAnyway);
}

/**
 * The fold at a tab `width` wide, where `hasRoomAt` says whether a tab that
 * wide has room for the folder beside the file. With room, it folds once
 * the tab has none; without, it waits for room `UNFOLD_MARGIN` past that.
 * A verdict that changes ends a folder shown by hand; the same verdict
 * returns the same fold.
 */
export function foldToWidth(
  fold: FolderFold,
  width: number,
  hasRoomAt: (width: number) => boolean,
): FolderFold {
  const hasRoom = hasRoomAt(fold.hasRoom ? width : width - UNFOLD_MARGIN);
  return hasRoom === fold.hasRoom
    ? fold
    : { ...fold, hasRoom, isShownAnyway: false };
}

/**
 * The person's toggle: a shown folder is hidden at every width; a hidden
 * one shows, where the tab has no room for it too.
 */
export function toggleFolder(fold: FolderFold): FolderFold {
  return showsFolder(fold)
    ? hideFolder(fold)
    : { ...fold, isShownAnyway: !fold.hasRoom, isWanted: true };
}

/** The person put the folder away: hidden at every width until shown again. */
export function hideFolder(fold: FolderFold): FolderFold {
  return { ...fold, isShownAnyway: false, isWanted: false };
}
