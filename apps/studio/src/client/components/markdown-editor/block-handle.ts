import { type Ctx } from "@milkdown/kit/ctx";
import {
  type BlockService,
  blockServiceInstance,
} from "@milkdown/kit/plugin/block";

import { watchPlacement } from "./placement";

/** How long the handle takes to come up beside a block, in ms. */
const FADE_IN_MS = 100;

/**
 * Makes Crepe's block handle (the + and the grip in the gutter) keep to the
 * block the pointer is on: it stays put while the pointer is between blocks,
 * and comes up in a quick fade where it lands. That it gets there at once is
 * the patch on `@milkdown/plugin-block`, which reads the pointer on every
 * move. Returns the teardown.
 */
export function installBlockHandle(ctx: Ctx, root: HTMLElement): () => void {
  holdBetweenBlocks(ctx.get(blockServiceInstance.key));
  return fadeOnLanding(root);
}

/**
 * Keeps the handle on the block it has while the pointer is level with space
 * that is no block's own: between two blocks, between two items of a list,
 * under the last block.
 *
 * The block plugin stands the handle beside whatever is at the pointer's
 * height. Between two blocks that is nothing, and the handle hides; between
 * two items of a list it is the list around them, whose own handle is at its
 * top, so the handle leaves for the first row of the list and comes back.
 * Neither is the pointer being on a block. Only a reading on a block of text
 * or on a leaf (a rule, an image, raw HTML) is, so only those reach the
 * plugin, which picks the block from there as it always has: the item, or
 * the list when the item is its first.
 */
function holdBetweenBlocks(service: BlockService) {
  const read = service.mousemoveCallback;
  service.mousemoveCallback = (view, event) => {
    // Where the plugin itself looks: the pointer's height, down the middle
    // of the text.
    const box = view.dom.getBoundingClientRect();
    const at = view.posAtCoords({
      left: box.left + box.width / 2,
      top: event.clientY,
    });
    const node = at && at.inside >= 0 ? view.state.doc.nodeAt(at.inside) : null;
    return node && (node.isTextblock || node.isLeaf)
      ? read(view, event)
      : false;
  };
}

/**
 * Fades the handle in each time it lands beside a block, whether it was
 * hidden or on another block.
 *
 * It is one element, moved from block to block the moment the pointer is on
 * another. It goes from the old block at once and comes up at the new one,
 * quickly enough to read as already there. Its going is a CSS transition
 * (markdown-editor.css); its coming cannot be, since nothing a selector can
 * see changes when only the position does.
 */
function fadeOnLanding(root: HTMLElement): () => void {
  let place = "";
  let fade: Animation | undefined;
  const stopWatching = watchPlacement(
    root,
    "milkdown-block-handle",
    (handle) => {
      const next =
        handle.dataset.show === "true"
          ? `${handle.style.left} ${handle.style.top}`
          : "";
      if (next && next !== place) {
        fade?.cancel();
        fade = handle.animate(
          { opacity: [0, 1] },
          { duration: FADE_IN_MS, easing: "ease-out" },
        );
      }
      place = next;
    },
  );
  return () => {
    stopWatching();
    fade?.cancel();
  };
}
