import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { isFileDownloadable } from "@/client/lib/file-actions";
import { type FileType, getFileType } from "@/client/lib/get-file-type";

// Whether the file's bytes are text a user could paste somewhere, which is what
// makes Copy worth offering for a type the clipboard cannot take natively.
//
// Exhaustive so a new `FileType` has to decide: as a list of matches, `.csv`
// lost Copy the moment it stopped being reported as `code`. The Office formats
// are zip containers, so their bytes are not paste-able even though the
// documents inside them are mostly text.
const IS_TEXT_LIKE: Record<FileType, boolean> = {
  archive: false,
  audio: false,
  code: true,
  csv: true,
  docx: false,
  html: true,
  image: false,
  iwork: false,
  jsonl: true,
  markdown: true,
  parquet: false,
  pdf: false,
  pptx: false,
  sqlite: false,
  text: true,
  unknown: false,
  video: false,
  xlsx: false,
};

// Which actions a file's menu offers. Answered from the file's own type and
// URL, not from whether it is on disk: an action that turns out to have no file
// behind it says so when it runs, which is both accurate and later than any
// check made while drawing the menu could be.
export function useFileActionVisibility(file: TaskFileViewerFile) {
  const fileType = getFileType(file);
  const isDownloadable = isFileDownloadable(file.url);
  // The clipboard takes an image natively and text as a paste. Nothing else has
  // a representation worth offering.
  const isCopyable = fileType === "image" || IS_TEXT_LIKE[fileType];

  return {
    showCopy: isCopyable && isDownloadable,
    showDownload: isDownloadable,
    showOpen: true,
    showReveal: true,
  };
}
