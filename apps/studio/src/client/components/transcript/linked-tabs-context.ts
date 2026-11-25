import { type LinkedTab } from "@instrument-org/workspace/client";
import { createContext } from "react";

/**
 * The web pages of the tabs a turn's reply linked, by tab id, as its turn
 * ended (`linkedTabsOf`). Absent outside a transcript's turn, and while the
 * turn is going.
 */
export const LinkedTabsContext = createContext<
  ReadonlyMap<string, LinkedTab> | undefined
>(undefined);
