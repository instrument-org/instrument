import {
  endOwnFileDrag,
  isOwnFileDragOf,
  isSelfFileDrag,
  releaseSelfFileDrag,
} from "@/client/lib/self-file-drag";
import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { useEffect } from "react";

import { filesOfDrop } from "./drag/held-tabs";
import { carriesFiles } from "./drag/native-drag";
import { type DroppedFile } from "./drag/types";

/**
 * The window as the drop target of last resort: files let go of where
 * nothing else takes them open the way a drop on the Dock icon does, every
 * one of them at once. Nothing is
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
  onOpen: (dropped: readonly DroppedFile[]) => void,
) {
  const handlers = useSteadyCallbacks({ onOpen });

  useEffect(() => {
    // Cancelled so the drop is allowed here at all.
    const take = (event: DragEvent) => {
      if (!carriesFiles(event) || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event) || event.defaultPrevented) {
        return;
      }
      // Cancelled either way, so a file let go of here is never the page
      // the window navigates to.
      event.preventDefault();
      // Read while the drop is being dispatched: the items empty after.
      const dropped = event.dataTransfer ? filesOfDrop(event.dataTransfer) : [];
      // A file this app put in the air and let go of again nowhere in
      // particular: a click that moved too far, or rows of Files carried
      // however long to a place that takes none.
      const isOwnDrag =
        isSelfFileDrag() ||
        isOwnFileDragOf(dropped.map((file) => file.hostPath));
      releaseSelfFileDrag();
      endOwnFileDrag();
      if (!isOwnDrag && dropped.length > 0) {
        handlers.onOpen(dropped);
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
  }, [handlers]);
}
