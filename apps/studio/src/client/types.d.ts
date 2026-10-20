import type { DraftsBridge } from "@/shared/drafts";
import type { BookmarksBridge } from "@/shared/bookmarks";
import type { KeptFile, KeptSnapshot } from "@/shared/kept-state";
import type { ElectronAPI } from "@electron-toolkit/preload";
import type { CaptureContext } from "@instrument-org/shared";
import type { SerializedError } from "@instrument-org/shared/exceptions";

declare module "*.md" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    api: {
      // Main's bookmarks (`client/bookmarks/store.ts`): every one as the
      // window loaded, ops sent back, and every change from anywhere. Absent
      // outside Electron.
      bookmarks?: BookmarksBridge;
      // Hands a captured exception to the main process, which keeps it as an
      // event and answers how a report names it. Absent outside Electron.
      captureException?: (payload: {
        context?: CaptureContext;
        error: SerializedError;
      }) => Promise<{ fingerprint: string; id: string } | null>;
      // Tells the main process whether a code editor holds the keyboard, so
      // the window's chords that are also the editor's keys reach it first.
      // Absent outside Electron.
      codeEditorFocus?: (focused: boolean) => void;
      getFilePath: (file: File) => string;
      // The drafts main owns (`shared/drafts.ts`, `client/drafts/store.ts`):
      // every draft as the window loaded, ops sent back, and every change
      // main makes. Absent outside Electron.
      drafts?: DraftsBridge;
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
