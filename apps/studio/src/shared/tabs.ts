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
/**
 * An app command sent from the main process (native menus / accelerators) to
 * the renderer that owns the window (AppShell), streamed over the one command
 * bus. Most are tab operations (`navigate` with `newTab` opens a new tab;
 * without it the active tab navigates; `close` closes the active tab); the rest
 * drive app-wide view state (sidebar, settings, command menu, reload, zoom) the
 * renderer owns, so there is no second signal channel.
 */
export type AppCommand =
  | { appPath: string; newTab?: boolean; type: "navigate" }
  | { index: number; type: "selectByIndex" }
  | { type: "close" }
  | { type: "navigateBack" }
  | { type: "navigateForward" }
  | { type: "openSettings" }
  | { type: "reload" }
  | { type: "reopen" }
  | { type: "selectLast" }
  | { type: "selectNext" }
  | { type: "selectPrevious" }
  | { type: "toggleCommandMenu" }
  | { type: "toggleSidebar" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" };

export type Tab = z.output<typeof TabSchema>;
