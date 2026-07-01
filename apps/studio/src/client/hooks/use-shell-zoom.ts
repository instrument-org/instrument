import type { CSSProperties } from "react";

import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";

/**
 * Merges the current shell zoom into a style object, for a Radix portal's own
 * Content element. Radix portals to `document.body`, outside the zoomed
 * AppShell root, so floating content (Dialog/Popover/DropdownMenu/etc.)
 * doesn't inherit CSS `zoom` from an ancestor. Each of those primitives
 * applies this directly to its own positioned Content instead:
 * `top`/`left`/`transform` resolve against the (unzoomed) containing block, so
 * self-applying zoom rescales the element's own rendered size without
 * disturbing where floating-ui already placed it. Omitted at 1x to avoid a
 * no-op `zoom` declaration on every such element.
 */
export function useShellZoomStyle(style?: CSSProperties): CSSProperties {
  const zoom = useAtomValue(zoomAtom);
  return { zoom: zoom === 1 ? undefined : zoom, ...style };
}
