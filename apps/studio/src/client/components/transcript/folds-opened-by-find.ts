import { createContext } from "react";

/**
 * The turns, by id, whose Worked row a chat's find holds open while it has
 * matches in their folded work, so the matches are drawn to be found.
 */
export const FoldsOpenedByFind = createContext<ReadonlySet<string>>(
  new Set<string>(),
);
