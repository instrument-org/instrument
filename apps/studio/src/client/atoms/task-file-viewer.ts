import { type TaskId } from "@instrument-org/workspace/client";
import { atom } from "jotai";

export interface TaskFileViewerFile {
  filename: string;
  filePath: string;
  mimeType: string;
  modifiedAt: number;
  taskId: TaskId;
  url: string;
}

interface TaskFileViewerState {
  currentIndex: number;
  files: TaskFileViewerFile[];
  isModalOpen: boolean;
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
    }: {
      currentIndex?: number;
      files: TaskFileViewerFile[];
    },
  ) => {
    set(taskFileViewerAtom, (prev) => ({
      ...prev,
      currentIndex,
      files,
      isModalOpen: true,
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
