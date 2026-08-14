/**
 * The height a collapsed grid clamps to: two rows of chips, or one row of media
 * tiles and the top of the next.
 *
 * A height and not a number of files, because how many files a row holds is not
 * something the grid knows: every section wraps to its container, so the same
 * six tiles are two rows in a message column and three in a narrow pane. A count
 * cut the grid at a different size everywhere it was drawn, and it was counting
 * the wrong thing on both ends -- "Show 2 more" under a grid still showing three
 * rows of images, and a row clipped by a cap nobody was told about.
 */
export const COLLAPSED_MAX_HEIGHT_PX = 144;

/**
 * How far the clamp's bottom edge dissolves, so a cut row reads as "more below"
 * rather than a slice. Sized to land on the row boundary above it, since a fade
 * long enough to reach back into a row that is fully on screen dims a file the
 * reader is being shown.
 *
 * It is also the room the clamp gives away when the first row is taller than it:
 * a lone image is a full-width square, so a fixed height would cut the one file
 * the reply is about. The first row is always drawn whole, and this is what is
 * left over for the hint of the row beneath it.
 */
export const FADE_HEIGHT_PX = 32;

/**
 * What the collapse costs: the row the button sits in, and the gap above it. A
 * grid that overruns the clamp by less than that is drawn whole instead, since
 * cutting a card by a few pixels to save fewer is how "Show 1 more" ends up
 * under a grid the reader can already see all of.
 */
const COLLAPSE_SLACK_PX = 36;

/**
 * The box one file takes, whichever section drew it.
 *
 * A tile still being typed (`data-pending`) is one of these boxes for the
 * clamp's purposes and not for the button's -- it takes room like a card, and
 * there is nothing behind it to show.
 */
export const FILE_ITEM_SELECTOR = "[data-slot='files-grid-item']";

/** One file's box, measured from the top of the clamped grid. */
export interface CollapseItem {
  bottom: number;
  isPending?: boolean;
  top: number;
}

/**
 * What a collapsed grid clamps to and what that clamp hides, given where every
 * file landed.
 *
 * Separate from the measuring so the rules can be read and tested as numbers:
 * they are product decisions (how much of a reply a file list may take, what
 * "more" counts as) rather than anything about the DOM.
 *
 * A file counts as hidden when its bottom falls past the clamp, so the number
 * offered is the number you cannot see all of, and expanding never reveals fewer
 * than it promised. `height` comes back undefined when the grid fits, which
 * takes the clamp off rather than leaving it to cut a grid with nothing to hide.
 */
export function collapseFor(items: CollapseItem[]) {
  const nothingHidden = { clipped: false, height: undefined, hiddenFiles: 0 };

  const first = items.at(0);
  if (!first) {
    return nothingHidden;
  }

  // Anything starting before the first item ends shares its row.
  const firstRowBottom = Math.max(
    ...items
      .filter((item) => item.top < first.bottom)
      .map((item) => item.bottom),
  );
  const height = Math.max(
    COLLAPSED_MAX_HEIGHT_PX,
    firstRowBottom + FADE_HEIGHT_PX,
  );

  const contentBottom = Math.max(...items.map((item) => item.bottom));
  if (contentBottom <= height + COLLAPSE_SLACK_PX) {
    return nothingHidden;
  }

  const cut = items.filter((item) => item.bottom > height);
  return {
    // The fade follows the cut and the button follows the files, so a pending
    // tile the clamp catches still dissolves rather than ending on an edge.
    clipped: cut.length > 0,
    height,
    hiddenFiles: cut.filter((item) => !item.isPending).length,
  };
}

/**
 * How far an item sits below the top of the clamped box, in layout pixels.
 *
 * Offsets rather than the difference between two `getBoundingClientRect`s: the
 * grid renders inside the window's CSS `zoom`, which rects report through and
 * `offsetTop` does not. The clamp is an intrinsic height, so the measurement has
 * to be in the units the layout was done in, not the ones it was painted at.
 * Walked rather than read once, because a section between the item and the box
 * may be positioned and own the offset instead.
 */
export function offsetTopWithin(element: HTMLElement, container: HTMLElement) {
  let top = 0;
  let node: HTMLElement | null = element;
  while (node !== null && node !== container) {
    top += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  return top;
}
