import type { CSSProperties } from "react";

import { isPaleChannelColor } from "@/client/components/orchestrator/channel-colors";

/**
 * The one declaration the `channel-tint` utility reads: the channel's own
 * color, which the utility rebuilds at a fixed lightness and chroma before
 * mixing it into the theme's ground. Wear the class and this together, since
 * neither paints anything on its own.
 *
 * A channel with no color hands back nothing, leaving the surface whatever it
 * draws for a channel that was never marked.
 */
export function channelTint(color: string | undefined): CSSProperties {
  if (!color) {
    return {};
  }
  // The tier the color was picked from, carried alongside the hue: a pale and
  // a deep entry of one hue would otherwise come out the same, since the
  // rebuild keeps nothing else of what was chosen.
  const pale = isPaleChannelColor(color);
  // Cast because a custom property is not a key `CSSProperties` knows, which is
  // the one thing this object is for.
  return {
    "--channel-chroma": pale ? "0.06" : "0.155",
    "--channel-color": color,
    "--channel-lightness": pale ? "0.86" : "0.54",
  } as CSSProperties;
}
