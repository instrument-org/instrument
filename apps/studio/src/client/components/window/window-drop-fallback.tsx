import {
  isSelfFileDrag,
  releaseSelfFileDrag,
} from "@/client/lib/self-file-drag";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { useEffect, useRef, useState } from "react";

/** How long the note survives without a `dragover` the window took. */
const STALE_DRAG_MS = 1000;

/**
 * The window as the drop target of last resort: a file let go of where
 * nothing else takes one opens in a tab of its own, the way a drop on the
 * Dock icon does, and a folder opens the Finder standing in it.
 *
 * Every other target (the composer, the chat, the Finder) claims a drag by
 * cancelling its `dragover` and `drop`, and most stop it there too. So this
 * listens on the window, in the bubble phase, and takes only what reached it
 * uncancelled; the note is drawn only for a `dragover` this took, read once
 * the event has finished dispatching. A drag over an in-app browser page
 * goes to the page and never reaches the window at all.
 */
export function WindowDropFallback({
  onOpen,
}: {
  onOpen: (dropped: { hostPath: string; isFolder: boolean }) => void;
}) {
  const [isShown, setShown] = useState(false);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    let staleTimer: number | undefined;
    let taken: Event | null = null;
    const hide = () => {
      window.clearTimeout(staleTimer);
      setShown(false);
    };
    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;

    // Seen first, judged once every target has had its say.
    const watch = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      window.setTimeout(() => {
        if (taken === event && !isSelfFileDrag()) {
          setShown(true);
          window.clearTimeout(staleTimer);
          staleTimer = window.setTimeout(hide, STALE_DRAG_MS);
        } else {
          hide();
        }
      });
    };
    const take = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      taken = event;
    };
    const leave = (event: DragEvent) => {
      // Out of the window altogether.
      if (event.relatedTarget === null) {
        hide();
      }
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || event.defaultPrevented) {
        hide();
        return;
      }
      // Cancelled either way, so a file let go of here is never the page
      // the window navigates to.
      event.preventDefault();
      hide();
      const isOwnDrag = isSelfFileDrag();
      releaseSelfFileDrag();
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

    window.addEventListener("dragenter", watch, { capture: true });
    window.addEventListener("dragover", watch, { capture: true });
    window.addEventListener("dragenter", take);
    window.addEventListener("dragover", take);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      hide();
      window.removeEventListener("dragenter", watch, { capture: true });
      window.removeEventListener("dragover", watch, { capture: true });
      window.removeEventListener("dragenter", take);
      window.removeEventListener("dragover", take);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return isShown ? (
    <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-500/60 bg-brand-500/5">
      <span className="flex items-center gap-2 rounded-full bg-popover px-4 py-2 text-sm font-medium shadow-float-lg">
        <ArrowSquareOutIcon className="size-4 text-brand-600" />
        Open in a new tab
      </span>
    </div>
  ) : null;
}
