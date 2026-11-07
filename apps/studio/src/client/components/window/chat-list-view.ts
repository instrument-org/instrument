import { keptAtom } from "@/client/lib/kept-state";

/**
 * How much of each chat its row in the list shows: three lines (the title,
 * the agent's latest line, then the project and the files it made), two (the
 * title, then the project, or the latest line for a chat under none), or the
 * title alone.
 */
export type RowDensity = "one" | "three" | "two";

const DENSITIES: readonly RowDensity[] = ["one", "three", "two"];

/** How the person likes the list's rows, the same in every window. */
export const rowDensityAtom = keptAtom<RowDensity>(
  "view",
  "chat-row-density.v1",
  "three",
  (value, initial) => DENSITIES.find((density) => density === value) ?? initial,
);

/** Whether the list puts a heading over each day's chats. */
export const groupByDayAtom = keptAtom(
  "view",
  "chat-list-day-groups.v1",
  false,
);

/** Whether the list's Projects section is open, or folded down to its heading. */
export const projectsOpenAtom = keptAtom("view", "chat-list-projects.v1", true);
