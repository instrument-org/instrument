import { TabIconsSchema } from "@instrument-org/shared/icons";
import { BrowserTargetIdSchema } from "@instrument-org/workspace/client";
import { z } from "zod";

// A tab's memory-history stack, captured on close so reopening restores the
// tab's back/forward history, not just its last location.
const TabHistorySchema = z.object({
  entries: z.array(z.string()),
  index: z.number(),
});
export type TabHistory = z.output<typeof TabHistorySchema>;

/**
 * A history with every entry at the address `move` gives it, or the same
 * history when no entry moved.
 */
export function movedTabHistory<T extends TabHistory | undefined>(
  history: T,
  move: (href: string) => string,
): T {
  if (history === undefined) {
    return history;
  }
  const entries = history.entries.map(move);
  return entries.every((entry, at) => entry === history.entries[at])
    ? history
    : { ...history, entries };
}

// A tab's stable identity. Distinct from `chatId`: a tab is a window into a
// route (which may be a task, a project, the new-tab page, ...), so the brand
// keeps the two from being passed interchangeably even though both are strings.
export const TabIdSchema = z.string().brand("TabId");
export type TabId = z.output<typeof TabIdSchema>;

// Where the keyboard and the scrolling stand in a tab on its way to another
// window, which starts with none of the elements they stood on. Each path is
// the place an element stands at each step down from what the tab draws into.
const TabViewSchema = z.object({
  focus: z.array(z.number()).nullable(),
  scrolls: z.array(
    z.object({
      left: z.number(),
      path: z.array(z.number()),
      top: z.number(),
    }),
  ),
});
export type TabView = z.output<typeof TabViewSchema>;

export const TabSchema = z.object({
  /** Gone once the window it arrives in has put it back. */
  arrivingView: TabViewSchema.optional(),
  history: TabHistorySchema.optional(),
  iconName: TabIconsSchema.optional(),
  id: TabIdSchema,
  pathname: z.string(),
  title: z.string().optional(),
});

export type Tab = z.output<typeof TabSchema>;

/**
 * A closed tab, with where it stood in the strip so a reopen puts it back
 * there, and when it closed, so a window closed since comes back before it.
 */
const ClosedTabSchema = TabSchema.extend({
  closedAt: z.number().optional(),
  index: z.number().optional(),
});

export const TabsModelSchema = z.object({
  recentlyClosed: z.array(ClosedTabSchema),
  selectedId: TabIdSchema.nullable(),
  tabs: z.array(TabSchema),
});
export type TabsModel = z.output<typeof TabsModelSchema>;

/** What comes up in place of the tab at a place along a strip: the one to its right, or else its left. */
export function neighborAt<T>(tabs: readonly T[], at: number): T | undefined {
  return tabs[at + 1] ?? tabs[at - 1];
}

/** A tab as another window would take it: the tab, the pages that go with it, and those of the tab that comes up in its place. */
export const TabStandingSchema = z.object({
  /** Pages drawn inside the tab's screens, which are this window's and go nowhere, but can make it stay with the tab. */
  hostedPages: z.array(BrowserTargetIdSchema),
  neighborPages: z.array(BrowserTargetIdSchema),
  pages: z.array(BrowserTargetIdSchema),
  tab: TabSchema,
});
export type TabStanding = z.output<typeof TabStandingSchema>;

/** Where a tab can go: a new window beside this one, or one open already. */
export const TabMoveDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ id: z.string(), kind: z.literal("window") }),
]);
export type TabMoveDestination = z.output<typeof TabMoveDestinationSchema>;

/** A tab held over a window's strip, which stands among its tabs at the pointer until it is let go. */
export interface IncomingTab {
  clientX: number;
  kind: "incoming";
  pointInTab: number;
  tab: { id: TabId; pathname: string };
}

/**
 * What main has a window's strip show of a tab's drag, which is otherwise its own
 * tabs. A spare window waiting for the release shows its tabs with nobody looking at
 * them. A window being given other tabs out of sight does not animate them, and one
 * coming up in place of a strip showing a tab held over it draws that tab where the
 * strip it replaces has it.
 */
export type TabCarryView =
  | IncomingTab
  | { kind: "beneath" }
  | { held?: IncomingTab; kind: "reshaping" }
  | { kind: "row" };
