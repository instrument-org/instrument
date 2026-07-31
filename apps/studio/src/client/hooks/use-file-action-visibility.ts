import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useTaskFileReferenceStatus } from "@/client/components/task/current-task-files";
import { isFileCopyable, isFileDownloadable } from "@/client/lib/file-actions";
import { type FileType, getFileType } from "@/client/lib/get-file-type";

// Whether the file's bytes are text a user could paste somewhere, which is what
// makes Copy worth offering for a type the clipboard cannot take natively.
//
// Exhaustive so a new `FileType` has to decide: as a list of matches, `.csv`
// lost Copy the moment it stopped being reported as `code`. The Office formats
// are zip containers, so their bytes are not paste-able even though the
// documents inside them are mostly text.
const IS_TEXT_LIKE: Record<FileType, boolean> = {
  audio: false,
  code: true,
  csv: true,
  docx: false,
  html: true,
  image: false,
  markdown: true,
  pdf: false,
  pptx: false,
  text: true,
  unknown: false,
  video: false,
  xlsx: false,
};

export function useFileActionVisibility(file: TaskFileViewerFile) {
  const referenceStatus = useTaskFileReferenceStatus(file);
  if (referenceStatus === "missing") {
    return {
      showCopy: false,
      showDownload: false,
      showReveal: false,
    };
  }

  const isDownloadable = isFileDownloadable(file.url);
  const isCopyableByMime = isFileCopyable(file.mimeType, file.url);
  const isTextLike = IS_TEXT_LIKE[getFileType(file)];

  return {
    showCopy: isCopyableByMime || (isTextLike && isDownloadable),
    showDownload: isDownloadable,
    showOpen: true,
    showReveal: true,
  };
}
