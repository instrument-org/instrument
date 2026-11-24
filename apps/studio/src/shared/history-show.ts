/** History's filters, past All: the kinds of row, and the tab groups closed, which are cards. */
export const SHOWS = [
  "pages",
  "files",
  "chats",
  "changes",
  "ai",
  "closed",
] as const;

export type Show = (typeof SHOWS)[number];

/**
 * The filter a thing the person did shows under, by its kind: what History's
 * list, its CSV and the boxes of its Clear dialog all go by.
 */
export function showOfAction(kind: string): Exclude<Show, "ai" | "closed"> {
  switch (kind) {
    case "page": {
      return "pages";
    }
    case "download":
    case "file":
    case "folder":
    case "open-with": {
      return "files";
    }
    case "chat": {
      return "chats";
    }
    default: {
      return "changes";
    }
  }
}

/** Whether an action is a row of History: not one saying where the log stopped writing, nor a visit to one of the app's own screens, which is only the way to something else. */
export function isListedAction<A extends { kind: string }>(
  action: A,
): action is Exclude<A, { kind: "capped" | "screen" }> {
  return action.kind !== "capped" && action.kind !== "screen";
}
