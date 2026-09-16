import type { CSSProperties } from "react";

import { isPaleTopicColor } from "@/client/components/orchestrator/topic-colors";

/**
 * The one declaration the `topic-tint` utility reads: the topic's own
 * color, which the utility rebuilds at a fixed lightness and chroma before
 * mixing it into the theme's ground. Wear the class and this together, since
 * neither paints anything on its own.
 *
 * A topic with no color hands back nothing, leaving the surface whatever it
 * draws for a topic that was never marked.
 */
export function topicTint(color: string | undefined): CSSProperties {
  if (!color) {
    return {};
  }
  // The tier the color was picked from, carried alongside the hue: a pale and
  // a deep entry of one hue would otherwise come out the same, since the
  // rebuild keeps nothing else of what was chosen.
  const pale = isPaleTopicColor(color);
  // Cast because a custom property is not a key `CSSProperties` knows, which is
  // the one thing this object is for.
  return {
    "--topic-chroma": pale ? "0.06" : "0.155",
    "--topic-color": color,
    "--topic-lightness": pale ? "0.86" : "0.54",
  } as CSSProperties;
}
