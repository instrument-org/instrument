import { atom } from "jotai";

interface FilePreviewState {
  file: null | {
    filename: string;
    // Where the file this preview is showing sits on the computer. Present
    // when the opener knew it -- a markdown embed pointing at a task path --
    // and absent when all it had was a URL, which is enough to draw the image
    // and not enough to act on the file behind it.
    hostPath?: string;
    mimeType?: string;
    size?: number;
    url: string;
  };
  isOpen: boolean;
}

const initialState: FilePreviewState = {
  file: null,
  isOpen: false,
};

export const filePreviewAtom = atom<FilePreviewState>(initialState);

export const openFilePreviewAtom = atom(
  null,
  (_get, set, file: NonNullable<FilePreviewState["file"]>) => {
    set(filePreviewAtom, {
      file,
      isOpen: true,
    });
  },
);

export const closeFilePreviewAtom = atom(null, (_get, set) => {
  set(filePreviewAtom, initialState);
});
