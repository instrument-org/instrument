import type { CSSProperties } from "react";

import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";

/**
 * Merges the current main-window zoom into a style object, for a Radix portal's own
 * Content element. Radix portals to `document.body`, outside the zoomed
 * MainWindow root, so floating content (Dialog/Popover/DropdownMenu/etc.)
 * doesn't inherit CSS `zoom` from an ancestor. Each of those primitives
 * applies this directly to its own positioned Content instead:
 * `top`/`left`/`transform` resolve against the (unzoomed) containing block, so
 * self-applying zoom rescales the element's own rendered size without
 * disturbing where floating-ui already placed it. Omitted at 1x to avoid a
 * no-op `zoom` declaration on every such element.
 *
 * Interim: floating-ui doesn't yet correct positioning for CSS `zoom` on an
 * ancestor (https://github.com/floating-ui/floating-ui/issues/3032, fix
 * https://github.com/floating-ui/floating-ui/pull/3463 unmerged), so we can't
 * just zoom the MainWindow root and let portals inherit it. Once that lands and
 * Radix bumps to it, drop this hook and the per-content `zoom` and zoom only the
 * MainWindow root.
 *
 * Also exposes `--content-zoom` for sizing the zoomed element, which needs one
 * distinction held firmly:
 *
 * - `vw`/`vh` are *not* rescaled by the element's own `zoom`, so a `100vh` box
 *   renders `zoom x` the window height. Divide these by `var(--content-zoom)`;
 *   they mean "a share of the real window" and must stay one.
 * - Percentages *are* resolved in the zoomed element's own units already, so
 *   `width: 100%` on a fixed element correctly spans the window at any zoom.
 *   Dividing these shrinks the box below the share it asked for.
 * - `rem`/`px` are intrinsic sizes: how much room the content needs, in the
 *   same units the content is laid out in. Never divide these -- that pins the
 *   element's rendered size while its text grows, which is the one outcome zoom
 *   exists to prevent.
 */
export function useAppZoomStyle(style?: CSSProperties): CSSProperties {
  const zoom = useAtomValue(zoomAtom);
  return {
    "--content-zoom": zoom,
    zoom: zoom === 1 ? undefined : zoom,
    ...style,
  } as CSSProperties;
}

/**
 * Max-size utilities for a portalled Radix Content, applied alongside
 * {@link useAppZoomStyle}. Shared by every centered dialog so the compensation
 * isn't hand-copied per primitive (and silently skipped, which is how
 * AlertDialog clipped off-screen at zoom > 1).
 *
 * The content keeps its intrinsic size in layout units at every zoom level, so
 * it grows on screen with the text inside it, and only ever gives that up to
 * stay within the window. A dialog wanting a different intrinsic size overrides
 * these with the same `min(<intrinsic>, calc(<vw|vh>/var(--content-zoom)))`
 * shape written out literally -- Tailwind only generates arbitrary values it can
 * see in source, so this can't be built from parts at runtime.
 */
export const ZOOM_CONTENT_MAX_HEIGHT = "max-h-[calc(85vh/var(--content-zoom))]";
export const ZOOM_CONTENT_MAX_WIDTH =
  "max-w-[min(32rem,calc((100vw-2rem)/var(--content-zoom)))]";
