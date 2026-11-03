import type { CSSProperties } from "react";

import { isPaleProjectColor } from "@/client/components/window/project-colors";

/**
 * The declarations the `project-tint` utility reads: the project's own color,
 * whose hue the utility rebuilds at a fixed lightness and chroma per theme,
 * and the tier's chroma, which scales every surface it publishes. Wear the
 * class and this together, since neither paints anything on its own.
 *
 * A project with no color hands back nothing, leaving the surface whatever it
 * draws for a project that was never marked.
 */
export function projectTint(color: string | undefined): CSSProperties {
  if (!color) {
    return {};
  }
  // The tier the color was picked from, carried alongside the hue: a pale and
  // a deep entry of one hue would otherwise come out the same, since the
  // rebuild keeps nothing else of what was chosen.
  const pale = isPaleProjectColor(color);
  // Cast because a custom property is not a key `CSSProperties` knows, which is
  // the one thing this object is for.
  return {
    "--project-chroma": pale ? "0.09" : "0.16",
    "--project-color": color,
    "--project-lightness": pale ? "0.8" : "0.56",
  } as CSSProperties;
}
