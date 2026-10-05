import type { KeptFile, KeptSnapshot } from "@/shared/kept-state";
import type { ElectronAPI } from "@electron-toolkit/preload";

declare module "*.md" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    api: {
      getFilePath: (file: File) => string;
      // Where the user's home directory is, for shortening displayed paths.
      // Fixed for the life of the process, so the preload hands it over once
      // rather than the renderer asking per path.
      homeDir: string;
      // What the windows keep across launches (`client/lib/kept-state.ts`):
      // every key as the window loaded, writes back to the main process, and
      // the writes other windows make. Absent outside Electron.
      keptState?: {
        initial: KeptSnapshot;
        onChange: (
          listener: (file: KeptFile, key: string, value: unknown) => void,
        ) => () => void;
        set: (file: KeptFile, key: string, value: unknown) => void;
      };
      // Dev-only: forward a renderer log entry to the main-process dev log.
      rendererLog?: (entry: { args: unknown[]; level: string }) => void;
      // Hand files to the OS as a native drag, by where they are on the
      // computer. Absent outside Electron, which is what makes a surface stop
      // offering the drag at all.
      startFileDrag?: (files: string[]) => void;
      windowType?: "app" | "onboarding";
    };
    electron: ElectronAPI;
  }
}
