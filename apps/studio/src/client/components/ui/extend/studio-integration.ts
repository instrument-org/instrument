import type { CSSProperties } from "react";

import { useAppZoomStyle } from "@/client/hooks/use-app-zoom";
import { usePortalContainer } from "@/client/hooks/use-portal-container";

type StyleProp<State> =
  | ((state: State) => CSSProperties | undefined)
  | CSSProperties
  | undefined;

/**
 * Studio's scoped portal target, narrowed to what Base UI's Portal accepts.
 * The shared hook is typed against Radix's wider `Element | DocumentFragment`
 * container, but the provider only ever renders a `div`.
 */
export function useBaseUiPortalContainer() {
  const container = usePortalContainer();
  return container instanceof HTMLElement ? container : undefined;
}

/**
 * {@link useAppZoomStyle} adapted to Base UI's `style` prop, which additionally
 * accepts a state callback. Every portalled popup in this folder merges the
 * result into its own positioned element, the same way Studio's Radix
 * primitives do, because portalled content renders outside the zoomed root and
 * so does not inherit CSS `zoom`.
 */
export function useZoomStyle<State>(style: StyleProp<State>) {
  const zoomStyle = useAppZoomStyle();

  if (typeof style === "function") {
    return (state: State) => ({ ...zoomStyle, ...style(state) });
  }

  return { ...zoomStyle, ...style };
}
