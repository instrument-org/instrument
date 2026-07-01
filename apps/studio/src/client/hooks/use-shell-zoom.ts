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
 *
 * Interim: floating-ui doesn't yet correct positioning for CSS `zoom` on an
 * ancestor (https://github.com/floating-ui/floating-ui/issues/3032, fix
 * https://github.com/floating-ui/floating-ui/pull/3463 unmerged), so we can't
 * just zoom the AppShell root and let portals inherit it. Once that lands and
 * Radix bumps to it, drop this hook and the per-content `zoom` and zoom only the
 * AppShell root.
 */
export function useShellZoomStyle(style?: CSSProperties): CSSProperties {
  const zoom = useAtomValue(zoomAtom);
  return { zoom: zoom === 1 ? undefined : zoom, ...style };
}
