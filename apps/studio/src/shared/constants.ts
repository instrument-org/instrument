import {
  type StudioPath,
} from "@/shared/studio-path";

export const TOOLBAR_HEIGHT = 40;
export const SIDEBAR_WIDTH = 250;

// Shared by the main process (sets it) and new-tab route (validates it).
export const PRIVATE_BETA_SEARCH_PARAM = "privateBeta";

export const PRIVATE_BETA_LAUNCH = {
  initialParams: { [PRIVATE_BETA_SEARCH_PARAM]: "true" },
  initialPath: "/new-tab",
} satisfies {
  initialParams: Record<string, string>;
  initialPath: StudioPath;
};
