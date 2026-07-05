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

export const TabSchema = z.object({
  history: TabHistorySchema.optional(),
  iconName: TabIconsSchema.optional(),
  id: z.string(),
  pathname: z.string(),
  taskId: TaskIdSchema.optional(),
  title: z.string().optional(),
});

export type Tab = z.output<typeof TabSchema>;
