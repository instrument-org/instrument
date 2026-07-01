import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";

/**
 * Current shell zoom factor. Radix portals to `document.body`, outside the
 * zoomed AppShell root, so floating content (Dialog/Popover/DropdownMenu/etc.)
 * doesn't inherit CSS `zoom` from an ancestor. Each of those primitives applies
 * this value as `zoom` directly on its own positioned Content element instead:
 * `top`/`left`/`transform` resolve against the (unzoomed) containing block, so
 * self-applying zoom rescales the element's own rendered size without
 * disturbing where floating-ui already placed it.
 */
export function useShellZoom() {
  return useAtomValue(zoomAtom);
}
