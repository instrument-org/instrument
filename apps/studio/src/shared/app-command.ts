import { type StudioPath } from "@/shared/studio-path";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";

/**
 * An app command sent from the main process (native menus / accelerators) to
 * the renderer that owns the window (MainWindow), streamed over the one command
 * bus. Most are tab operations (`navigate` with `newTab` opens a new tab;
 * without it the active tab navigates; `focusTask` reuses a matching task tab;
 * `close` closes the active tab); the rest drive app-wide view state (sidebar,
 * settings, command menu, reload, zoom) the renderer owns, so there is no
 * second signal channel.
 *
 * `navigate.to` is a typed route path ({@link StudioPath}), so a stale route is
 * a compile error on the main-process side; concrete route params/search ride
 * alongside instead of being pre-baked into an untyped string.
 */
export type AppCommand =
  | {
      id: TaskId;
      sessionId: StoreId.Session;
      type: "focusTask";
    }
  | { index: number; type: "selectByIndex" }
  | {
      newTab?: boolean;
      params?: Record<string, string>;
      search?: Record<string, unknown>;
      to: StudioPath;
      type: "navigate";
    }
  | { theme: "dark" | "light" | "system"; type: "setTheme" }
  | { type: "close" }
  | { type: "findInPage" }
  | { type: "navigateBack" }
  | { type: "navigateForward" }
  | { type: "openSettings" }
  | { type: "openShortcutGuide" }
  | { type: "reload" }
  | { type: "reopen" }
  | { type: "selectLast" }
  | { type: "selectNext" }
  | { type: "selectPrevious" }
  | { type: "toggleCommandMenu" }
  | { type: "toggleSidebar" }
  | { type: "toggleTaskPane" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" };
