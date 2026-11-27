/**
 * How a tab's row gives up its controls as it narrows, a rung at a time, so
 * the address keeps its room down to the narrowest side (`SIDE_WIDTH_MIN`).
 * Each rung is a `@container/tabrow` width: below it the control is out of
 * the row, and the row's ⋮ menu lists it in its place (`rowFoldsOf`), so a
 * control folds only in a row whose menu says so (`data-row-menu` on its
 * trigger). Back, reload, the address, ⋮ and the pane's close never fold.
 *
 * - Below 36rem: Downloads, while nothing downloads; and the pinned
 *   extensions' buttons and the shield, which the puzzle piece's menu lists
 *   (`PINNED_EXTENSIONS_FOLD`).
 * - Below 32rem: Forward, and the field's open-in-app button, which ⋮ names
 *   among the apps that open the page (`OPEN_IN_APP_FOLD`).
 * - Below 28rem: the pane's New Tab, and the whole extensions group.
 * - Below 22rem: the bookmark star.
 *
 * A control whose own menu or card is open stays in the row while it is, so
 * what it opens has it to hang from (`rowFold`'s `isHeld`).
 */
const ROW_FOLDS = {
  downloads: "@max-[36rem]/tabrow:group-has-[[data-row-menu]]/tabrow:hidden",
  extensions: "@max-[28rem]/tabrow:group-has-[[data-row-menu]]/tabrow:hidden",
  forward: "@max-[32rem]/tabrow:group-has-[[data-row-menu]]/tabrow:hidden",
  newTab: "@max-[28rem]/tabrow:group-has-[[data-row-menu]]/tabrow:hidden",
  star: "@max-[22rem]/tabrow:group-has-[[data-row-menu]]/tabrow:hidden",
} as const;

/** The pinned extensions' buttons and the shield, which fold into the puzzle piece's menu. */
export const PINNED_EXTENSIONS_FOLD = "@max-[36rem]/tabrow:hidden";

/** The field's open-in-app button, which a row's ⋮ names among its apps. */
export const OPEN_IN_APP_FOLD =
  "@max-[32rem]/tabrow:group-has-[[data-row-menu]]/tabrow:hidden";

export type RowFold = keyof typeof ROW_FOLDS;

/** The attributes that mark a control as one its row folds, for `rowFoldsOf`. */
export function rowFold(fold: RowFold, isHeld = false) {
  return {
    className: isHeld ? undefined : ROW_FOLDS[fold],
    "data-row-fold": fold,
  };
}

/**
 * The controls the row around `inside` has folded away at its width, each
 * with its element: a `data-row-fold` control the row draws that is out of
 * sight. A control the row does not draw at all (no download yet, no pane
 * corner) is not listed.
 */
export function rowFoldsOf(
  inside: Element | null | undefined,
): Map<RowFold, HTMLElement> {
  const row = inside?.closest("[data-tab-location]");
  const folds = new Map<RowFold, HTMLElement>();
  if (!row) {
    return folds;
  }
  for (const element of row.querySelectorAll<HTMLElement>("[data-row-fold]")) {
    const fold = element.dataset.rowFold;
    if (isRowFold(fold) && !element.checkVisibility()) {
      folds.set(fold, element);
    }
  }
  return folds;
}

function isRowFold(value: string | undefined): value is RowFold {
  return value !== undefined && value in ROW_FOLDS;
}
