import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";
import { createContext, type ReactNode, useContext } from "react";

/**
 * Layout px of window chrome across the top of the window that floating content
 * has to stay out of.
 *
 * Zero unless a window says otherwise, because most of what renders this app
 * has no such band: the onboarding window draws no toolbar, and a component
 * rendered on its own in a test has no window around it at all.
 */
const ChromeInsetContext = createContext(0);

export function ChromeInsetProvider({
  children,
  top,
}: {
  children: ReactNode;
  top: number;
}) {
  return <ChromeInsetContext value={top}>{children}</ChromeInsetContext>;
}

/**
 * The `collisionPadding` every floating primitive in this window is given, which
 * holds menus, popovers and tooltips below the toolbar instead of over the
 * window controls sitting in it. macOS draws its traffic lights above the web
 * contents, so a menu reaching that far is not merely ugly there: the part of
 * it under the buttons cannot be clicked at all.
 *
 * Radix hands this padding to the same `size` middleware that publishes
 * `--radix-*-content-available-height`, which is what every one of these
 * primitives already caps its height against. So the band is subtracted from
 * the room a menu believes it has, and a menu too tall for what is left
 * shortens and scrolls rather than growing into it -- no measuring of our own,
 * and no exception for the composer menus, which turn Radix's collision
 * handling off and lean on that cap alone.
 *
 * On-screen px, the space Radix does its collision arithmetic in, so the band's
 * layout px are scaled by the zoom the window is drawn at -- the same product
 * the main process positions the traffic lights by.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useChromeCollisionPadding() {
  const top = useContext(ChromeInsetContext);
  const zoom = useAtomValue(zoomAtom);
  return { top: top * zoom };
}
