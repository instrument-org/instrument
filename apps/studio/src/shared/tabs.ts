import { TabIconsSchema } from "@instrument-org/shared/icons";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { z } from "zod";

// A tab's memory-history stack, captured on close so reopening restores the
// tab's back/forward history, not just its last location.
const TabHistorySchema = z.object({
  entries: z.array(z.string()),
  index: z.number(),
});
export type TabHistory = z.output<typeof TabHistorySchema>;

// A tab's stable identity. Distinct from `taskId`: a tab is a window into a
// route (which may be a task, a project, the new-tab page, ...), so the brand
// keeps the two from being passed interchangeably even though both are strings.
export const TabIdSchema = z.string().brand("TabId");
export type TabId = z.output<typeof TabIdSchema>;

export const TabSchema = z.object({
  history: TabHistorySchema.optional(),
  iconName: TabIconsSchema.optional(),
  id: TabIdSchema,
  pathname: z.string(),
  taskId: TaskIdSchema.optional(),
  title: z.string().optional(),
});

export type Tab = z.output<typeof TabSchema>;
