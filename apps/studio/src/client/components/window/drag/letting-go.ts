import { isBookmark, type Held, type Landing } from "./types";

/**
 * What letting go of what is held does where it would land, and the line
 * said under it while it is held there: one answer for every pair of what
 * can be held and where it can land, which the lander acts on and the drag
 * layer says.
 *
 * - `move`: a tab or a whole group goes there, as itself.
 * - `open`: a link or files open there as the tabs their addresses name.
 * - `keep`: kept on the bookmarks bar.
 *
 * Let go where nothing takes it, a bookmark stays where it is kept, as in a
 * browser's bar.
 *
 * No line where what is held already stands where it would go: its own
 * strip, a whole group's room in the list, a bookmark moving along the bar.
 */
export type Outcome =
  | { does: "keep" | "move" | "open"; line: string | undefined }
  | { does: "nothing"; line: undefined };

export function outcomeOf(
  held: Held,
  landing: Landing | undefined,
  /** How many tabs a whole group held brings, said where it goes to a side. */
  tabCount = 1,
): Outcome {
  const isOwnTab = held.kind === "tab" || held.kind === "group";
  const goes = (line: string | undefined): Outcome => ({
    does: isOwnTab ? "move" : "open",
    line,
  });
  if (!landing) {
    return { does: "nothing", line: undefined };
  }
  switch (landing.kind) {
    case "bookmarks": {
      return {
        does: "keep",
        line:
          isBookmark(held) || held.kind === "folder"
            ? undefined
            : "Add to bookmarks",
      };
    }
    case "strip": {
      // Its own tab stands in the strip itself; anything from elsewhere
      // goes to the line.
      if (landing.line === undefined) {
        return goes(undefined);
      }
      return goes(isOwnTab ? "Move to this side" : "Open in a new tab");
    }
    case "replace": {
      // Only content opens in a tab's place; a tab never replaces another.
      return isOwnTab
        ? { does: "nothing", line: undefined }
        : goes("Open in this tab");
    }
    case "side": {
      const line = landing.split
        ? landing.side === 0
          ? "Add left split"
          : "Add right split"
        : isOwnTab
          ? "Move to this side"
          : "Open on this side";
      return goes(tabCount > 1 ? `${line} · ${String(tabCount)} tabs` : line);
    }
    case "newTab": {
      return goes("Open here");
    }
    case "sidebar": {
      if (held.kind === "group") {
        // A whole group takes a room in the list, standing there itself.
        return landing.drop.kind === "between"
          ? goes(undefined)
          : { does: "nothing", line: undefined };
      }
      return goes(
        landing.drop.kind === "into" ? "Add to this group" : "New tab group",
      );
    }
    case "window": {
      return goes("New window");
    }
  }
}
