import type { ElectronAPI } from "@electron-toolkit/preload";

declare module "*.md" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    api: {
      getFilePath: (file: File) => string;
      windowType?: "onboarding" | "shell";
    };
    electron: ElectronAPI;
  }
}
