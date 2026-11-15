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
 * - `remove`: a bookmark let go where nothing takes it goes from the bar.
 *
 * No line where what is held already stands where it would go: a strip, a
 * whole group's room in the list, a bookmark moving along the bar.
 */
export type Outcome =
  | { does: "keep" | "move" | "open"; line: string | undefined }
  | { does: "nothing"; line: undefined }
  | { does: "remove"; line: string };

export function outcomeOf(
  held: Held,
  landing: Landing | undefined,
  /** How many tabs a whole group held brings, said where it makes a side of them. */
  tabCount = 1,
): Outcome {
  const isOwnTab = held.kind === "tab" || held.kind === "group";
  const goes = (line: string | undefined): Outcome => ({
    does: isOwnTab ? "move" : "open",
    line,
  });
  if (!landing) {
    return isBookmark(held)
      ? { does: "remove", line: "Remove from bookmarks" }
      : { does: "nothing", line: undefined };
  }
  switch (landing.kind) {
    case "bookmarks": {
      return {
        does: "keep",
        line: isBookmark(held) ? undefined : "Add to bookmarks",
      };
    }
    case "strip": {
      return goes(undefined);
    }
    case "side": {
      if (landing.split) {
        const split = landing.side === 0 ? "Add left split" : "Add right split";
        return goes(
          tabCount > 1 ? `${split} · ${String(tabCount)} tabs` : split,
        );
      }
      return goes(isOwnTab ? "Move to this side" : "Open on this side");
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
      // In a room what is held stands as the row it makes.
      return goes(
        landing.drop.kind === "into" ? "Add to this group" : undefined,
      );
    }
    case "window": {
      return goes("New window");
    }
  }
}
