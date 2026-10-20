import {
  endOwnFileDrag,
  isSelfFileDrag,
  releaseSelfFileDrag,
} from "@/client/lib/self-file-drag";
import { useEffect, useRef } from "react";

/**
 * The window as the drop target of last resort: a file let go of where
 * nothing else takes one opens in a tab of its own, the way a drop on the
 * Dock icon does, and a folder opens the Finder standing in it. Nothing is
 * drawn for it, since an outline there would read as a different promise
 * from whatever is under the pointer.
 *
 * Every other target (the composer, the chat, the Finder) claims a drag by
 * cancelling its `dragover` and `drop`, and most stop it there too. So this
 * listens on the window, in the bubble phase, and takes only what reached it
 * uncancelled. A drag over an in-app browser page goes to the page and never
 * reaches the window at all.
 */
export function useWindowDropFallback(
  onOpen: (dropped: { hostPath: string; isFolder: boolean }) => void,
) {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;
    // Cancelled so the drop is allowed here at all.
    const take = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented) {
        return;
      }
      // Cancelled either way, so a file let go of here is never the page
      // the window navigates to.
      event.preventDefault();
      const isOwnDrag = isSelfFileDrag();
      releaseSelfFileDrag();
      endOwnFileDrag();
      // A file this app put in the air and let go of again nowhere in
      // particular, as a click that moved too far does.
      if (isOwnDrag || !event.dataTransfer) {
        return;
      }
      for (const item of event.dataTransfer.items) {
        const file = item.kind === "file" ? item.getAsFile() : null;
        const hostPath = file ? window.api.getFilePath(file) : "";
        if (hostPath) {
          onOpenRef.current({
            hostPath,
            isFolder: item.webkitGetAsEntry()?.isDirectory ?? false,
          });
        }
      }
    };

    window.addEventListener("dragenter", take);
    window.addEventListener("dragover", take);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", take);
      window.removeEventListener("dragover", take);
      window.removeEventListener("drop", drop);
    };
  }, []);
}
