import { TabIconsSchema } from "@instrument-org/shared/icons";
import { z } from "zod";

// A tab's memory-history stack, captured on close so reopening restores the
// tab's back/forward history, not just its last location.
const TabHistorySchema = z.object({
  entries: z.array(z.string()),
  index: z.number(),
});
export type TabHistory = z.output<typeof TabHistorySchema>;

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
 * What a window shows of a tab held by the pointer. Its renderer keeps every tab
 * until the tab is let go, so this says only what the strip shows meanwhile: its
 * own tabs, the tab alone in a window following the pointer, or the tab among the
 * tabs of a window it is held over. A spare window waiting beneath the drag shows
 * its own tabs with nobody looking at them, until the tab leaves its row.
 */
export type TabCarryView =
  | { clientX: number; heldId: TabId; kind: "joined"; tabs: TabCarryNeighbor[] }
  | { heldId: TabId; kind: "alone" }
  | { kind: "beneath" }
  | { kind: "row" };

/** A tab of a window another tab is held over, as its strip draws it. */
interface TabCarryNeighbor {
  id: TabId;
  pathname: string;
}
