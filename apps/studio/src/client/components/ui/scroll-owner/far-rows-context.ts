import { createContext, use } from "react";

import { type FarRows } from "./far-rows";

/** The transcript's `FarRows`, from its message scroller's provider. */
export const FarRowsContext = createContext<FarRows | null>(null);

/**
 * The transcript's turns far from view, where there is a transcript. Its own
 * module, so code drawn outside one (any Markdown) asks without loading the
 * scroller.
 */
export function useOptionalFarRows(): FarRows | null {
  return use(FarRowsContext);
}
