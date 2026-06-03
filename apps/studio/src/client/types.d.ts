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
      onStudioOverlayNavigate: (callback: (location: string) => void) => void;
      tabId?: string;
      windowType?: "onboarding" | "shell" | "studio-overlay";
    };
    electron: ElectronAPI;
  }
}
