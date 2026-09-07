import type { CSSProperties } from "react";

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
  // Cast because a custom property is not a key `CSSProperties` knows, which is
  // the one thing this object is for.
  return { "--channel-color": color } as CSSProperties;
}
