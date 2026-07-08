import type { ElectronAPI } from "@electron-toolkit/preload";

declare module "*.md" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    api: {
      getFilePath: (file: File) => string;
      // Dev-only: forward a renderer log entry to the main-process dev log.
      rendererLog?: (entry: { args: unknown[]; level: string }) => void;
      windowType?: "main" | "onboarding";
    };
    electron: ElectronAPI;
  }
}
