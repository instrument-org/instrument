import { type ViewerFile } from "../atoms/viewer-file";

export function downloadBlob({
  blob,
  filename,
}: ViewerFile & {
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
