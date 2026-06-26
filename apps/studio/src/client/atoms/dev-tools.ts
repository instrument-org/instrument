import { atom } from "jotai";

type DevToolsPanel =
  | "agentation"
  | "analytics-toolbar"
  | "query-devtools"
  | "router-devtools";

export const devToolsPanelAtom = atom<DevToolsPanel | null>(null);
