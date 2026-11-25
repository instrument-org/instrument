import { type BookmarkChange } from "../schemas/bookmark-change";

/** A change to a bookmark or folder in words, a line for each thing about it that changed. With `id`, the short id the agent names it by. */
export function bookmarkChangeLines(
  { after, before, id }: BookmarkChange,
  withId?: "id",
): string[] {
  const side = after ?? before;
  const name = `"${side?.title || (side?.url ?? "")}"${withId ? ` (${id.slice(0, 8)})` : ""}`;
  if (before === null) {
    return [`Added ${name} to ${after?.place ?? ""}.`];
  }
  if (after === null) {
    return [`Removed ${name} from ${before.place}.`];
  }
  const isMoved =
    after.folder !== before.folder ||
    after.root !== before.root ||
    after.order !== before.order;
  return [
    ...(after.title === before.title
      ? []
      : [`Renamed "${before.title}" to ${name}.`]),
    ...(after.url === before.url
      ? []
      : [`${name} opens ${after.url ?? ""}, not ${before.url ?? ""}.`]),
    ...(isMoved
      ? [
          after.place === before.place
            ? `Moved ${name} in ${after.place}.`
            : `Moved ${name} from ${before.place} to ${after.place}.`,
        ]
      : []),
  ];
}
