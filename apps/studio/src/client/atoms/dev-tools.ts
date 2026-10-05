import { atom } from "jotai";

type DevToolsPanel = "agentation" | "query-devtools" | "router-devtools";

export const devToolsPanelAtom = atom<DevToolsPanel | null>(null);
