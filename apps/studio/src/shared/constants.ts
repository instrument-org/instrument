import { type StudioPath } from "@/shared/studio-path";

// Synchronous request the preload makes for the resolved theme, before the
// document is parsed. See serveResolvedTheme in electron-main/lib/theme-utils.
export const RESOLVE_THEME_CHANNEL = "resolve-theme";

export const TOOLBAR_HEIGHT = 40;
export const SIDEBAR_WIDTH = 250;

// Shared by the main process (sets it) and new-tab route (validates it).
export const PRIVATE_BETA_SEARCH_PARAM = "privateBeta";

// Every modifier+Space chord is already spoken for: Spotlight has Cmd+Space,
// Raycast and Alfred and ChatGPT all default to Alt+Space, Input Sources takes
// Ctrl+Space, and macOS keeps Ctrl+Cmd+Space and Alt+Cmd+Space for the emoji
// picker and Finder search. A losing registration is silent -- the app that
// asked last wins and the others simply never fire -- so the default is worth
// picking away from that crowd rather than into it.
//
// Control+Alt is the same physical chord on every platform, and it is still
// only a starting point: this is user-editable because whatever we pick
// collides with something on someone's machine.
export const DEFAULT_QUICK_CAPTURE_ACCELERATOR = "Control+Alt+I";

export const PRIVATE_BETA_LAUNCH = {
  initialParams: { [PRIVATE_BETA_SEARCH_PARAM]: "true" },
  initialPath: "/new-tab",
} satisfies {
  initialParams: Record<string, string>;
  initialPath: StudioPath;
};
