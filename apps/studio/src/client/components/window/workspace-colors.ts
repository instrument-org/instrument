import { type RPCOutput } from "@/client/rpc/client";

import { PROJECT_COLORS } from "./project-colors";

type WorkspaceColor = RPCOutput["workspaces"]["current"]["color"];

/**
 * Each workspace color as the deep tier of the project palette, so a workspace
 * reads in the same hues the app already uses to tell things apart. Hex rather
 * than utility classes: the app's theme defines no hue scales beyond its own.
 */
export const WORKSPACE_COLOR_HEX: Record<WorkspaceColor, string> = {
  blue: PROJECT_COLORS[13] ?? "#007fc3",
  gray: "var(--color-gray-400)",
  green: PROJECT_COLORS[11] ?? "#218b30",
  orange: PROJECT_COLORS[9] ?? "#b85300",
  pink: PROJECT_COLORS[15] ?? "#b2468a",
  purple: PROJECT_COLORS[14] ?? "#765fca",
  red: PROJECT_COLORS[8] ?? "#c0434c",
  teal: PROJECT_COLORS[12] ?? "#009178",
};
