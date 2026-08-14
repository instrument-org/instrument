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

/** Breathing room kept between portalled content and the window edge. */
const VIEWPORT_GUTTER = "2rem";

/**
 * A max-size for portalled, self-zoomed content, applied alongside
 * {@link useAppZoomStyle} as an inline `max-width`/`max-height`.
 *
 * `intrinsic` is how much room the content wants in the units it is laid out in,
 * undivided (see the unit rules above). It is capped here by the window the
 * content has to fit inside, so the content keeps its intrinsic size in layout
 * units at every zoom level -- growing on screen with the text inside it -- and
 * only ever gives that up to stay on screen. Omit it to ask for as much room as
 * the window allows.
 *
 * A value rather than Tailwind classes, because a class is the one form of this
 * that can be lost: `cn()` merges a caller's `max-w-*` over the primitive's own,
 * taking the window cap with it, and nothing says so at the call site. An inline
 * style outranks every class, so a dialog's size can only be set by passing an
 * intrinsic size in -- which is the point, since a dropped cap looks correct at
 * the 1x default and only misplaces the content once someone zooms in.
 */
export function zoomMaxSize(axis: "height" | "width", intrinsic?: string) {
  const viewport = axis === "width" ? "100vw" : "100vh";
  const windowCeiling = `calc((${viewport} - ${VIEWPORT_GUTTER}) / var(--content-zoom))`;
  return intrinsic ? `min(${intrinsic}, ${windowCeiling})` : windowCeiling;
}
