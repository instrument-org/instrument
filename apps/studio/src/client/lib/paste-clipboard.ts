/**
 * Decide whether a clipboard file item should be attached on paste.
 *
 * Apps like Word/PowerPoint on macOS place both `text/plain` and an image
 * rendering of the selected text on the clipboard. When usable text is present
 * we skip image representations so pasting text never lands as a PNG, while
 * still attaching genuinely-copied files (and image-only pastes with no text).
 */
export const shouldAttachClipboardItem = ({
  hasText,
  item,
}: {
  hasText: boolean;
  item: Pick<DataTransferItem, "kind" | "type">;
}) => {
  if (item.kind !== "file") {
    return false;
  }
  if (hasText && item.type.startsWith("image/")) {
    return false;
  }
  return true;
};
