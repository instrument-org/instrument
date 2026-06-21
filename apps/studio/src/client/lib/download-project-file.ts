import {
  type ProjectFileViewerFile,
} from "../atoms/project-file-viewer";

export function downloadProjectFile({
  blob,
  filename,
}: ProjectFileViewerFile & {
  blob: Blob;
}) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
