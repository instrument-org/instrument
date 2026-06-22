import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { isFileCopyable, isFileDownloadable } from "@/client/lib/file-actions";
import { getFileType } from "@/client/lib/get-file-type";

export function useFileActionVisibility(file: TaskFileViewerFile) {
  const fileType = getFileType(file);
  const isDownloadable = isFileDownloadable(file.url);
  const isCopyableByMime = isFileCopyable(file.mimeType, file.url);
  const isTextLike =
    fileType === "code" ||
    fileType === "text" ||
    fileType === "markdown" ||
    fileType === "html";

  return {
    showCopy: isCopyableByMime || (isTextLike && isDownloadable),
    showDownload: isDownloadable,
    showReveal: true,
  };
}
