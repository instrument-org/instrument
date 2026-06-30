import type { TabCommand } from "@/shared/tabs";
import type { ElectronAPI } from "@electron-toolkit/preload";

declare module "*.md" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    api: {
      getFilePath: (file: File) => string;
      onNavigate: (callback: (url: string) => void) => void;
      onStudioOverlayNavigate: (
        callback: (location: string, seq: number) => void,
      ) => void;
      /** Subscribe to main-process tab commands; returns an unsubscribe fn. */
      onTabCommand: (callback: (command: TabCommand) => void) => () => void;
      studioOverlayRouteReady: (location: string, seq: number) => void;
      tabId?: string;
      windowType?: "onboarding" | "shell" | "studio-overlay";
    };
    electron: ElectronAPI;
  }
}
