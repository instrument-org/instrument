import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { atom } from "jotai";

/**
 * A file some surface is offering to show or act on, by where it is on the
 * computer: the viewer reads its bytes by that path and every action (open,
 * reveal, copy, drag) acts on it. A file a task named arrives in the task's
 * own terms and is translated to this once, on its way to the screen.
 *
 * `mimeType` and `modifiedAt` arrive when something actually resolved the file
 * against disk, as the artifact panel does because it is about to read the
 * bytes, and are absent everywhere else.
 */
export interface ViewerFile {
  filename: string;
  hostPath: string;
  mimeType?: string;
  modifiedAt?: number;
  /**
   * The path the task wrote for it, with the task, when it came from one.
   * The task page addresses its panes by that path and a mention in the
   * composer names the file the way the agent knows it.
   */
  taskFile?: { filePath: string; taskId: TaskId };
  url: string;
}

interface TaskFileViewerState {
  currentIndex: number;
  files: ViewerFile[];
  isModalOpen: boolean;
  // The session the file was opened from. The modal mounts at the app chrome
  // rather than inside the task, so this is the only thing that carries the
  // session across -- and a link in a Markdown file needs it to name the
  // browser it could open in.
  sessionId?: StoreId.Session;
}

const initialState: TaskFileViewerState = {
  currentIndex: 0,
  files: [],
  isModalOpen: false,
};

export const taskFileViewerAtom = atom<TaskFileViewerState>(initialState);

export const openFileViewerAtom = atom(
  null,
  (
    _get,
    set,
    {
      currentIndex = 0,
      files,
      sessionId,
    }: {
      currentIndex?: number;
      files: ViewerFile[];
      sessionId?: StoreId.Session;
    },
  ) => {
    set(taskFileViewerAtom, (prev) => ({
      ...prev,
      currentIndex,
      files,
      isModalOpen: true,
      sessionId,
    }));
  },
);

export const closeFileViewerAtom = atom(null, (_get, set) => {
  set(taskFileViewerAtom, (prev) => ({
    ...prev,
    files: [],
    isModalOpen: false,
  }));
});

export const setTaskFileViewerIndexAtom = atom(
  null,
  (_get, set, index: number) => {
    set(taskFileViewerAtom, (prev) => ({ ...prev, currentIndex: index }));
  },
);
