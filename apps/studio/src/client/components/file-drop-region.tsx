import {
  type DropHandlers,
  type DroppedFolder,
  DropRegisterContext,
  type DropRegistration,
} from "@/client/hooks/use-file-drop-region";
import { captureException } from "@/client/lib/telemetry";
import { cn } from "@/client/lib/utils";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { type ReactNode, useEffect, useRef, useState } from "react";

// How long the overlay survives without a `dragover`. Generous, because the
// only cost of waiting is an overlay that lingers a moment after a drag it
// never saw end, and the cost of being wrong the other way is an overlay taken
// down while the file is still in the air.
const STALE_DRAG_MS = 1000;

/**
 * The area of the window that takes a dropped file, and the only thing that
 * says so.
 *
 * The region is declared by whoever owns the content, not measured: a task
 * wraps the chat column and the pane beside it is simply outside, a route with
 * nothing beside it wraps everything. So the shape follows the layout rather
 * than a rect each surface has to keep in agreement with its own.
 *
 * That the region is not the window is what the in-app browser makes necessary.
 * Its guest is a `<webview>` on `document.body` with `pointer-events: auto`,
 * so drags over it belong to the page it is showing; a window-wide affordance
 * would draw a border around a region it cannot accept a drop into, which is
 * the same lie as drawing the border only on the composer while taking drops
 * everywhere.
 */
export function FileDropRegion({
  children,
  className,
  note,
  onFilesDropped,
  onFoldersDropped,
}: {
  children: ReactNode;
  className?: string;
  // What a drop does, when the component drawing the region is also the one
  // that handles it. Given here rather than through `useFileDropRegion`,
  // because a component cannot read a context it provides in its own JSX: the
  // hook is for a descendant, which the composer is and a modal's own form is
  // not. Props win over a descendant's registration.
} & (
  | (DropHandlers & { note: string })
  | (Partial<DropHandlers> & { note?: undefined })
)) {
  const [registered, setRegistered] = useState<DropRegistration | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);

  // Two refs rather than one because the region's own handlers have to satisfy
  // the same shape a descendant registers, which requires `onFilesDropped`,
  // while the props are optional until `note` makes them required. Forwarding
  // through a props ref keeps the registered shape stable and always current.
  const propsRef = useRef({ onFilesDropped, onFoldersDropped });

  useEffect(() => {
    propsRef.current = { onFilesDropped, onFoldersDropped };
  });

  const ownHandlersRef = useRef<DropHandlers>({
    onFilesDropped: (files) => propsRef.current.onFilesDropped?.(files),
    onFoldersDropped: (folders) => propsRef.current.onFoldersDropped?.(folders),
  });

  // Read apart rather than as one registration object: `activeNote` is the only
  // one of the three that render touches, and keeping it a plain string is what
  // stops drawing the note from counting as reading a ref during render.
  const activeNote = note ?? registered?.note;
  const enabled = note ? true : (registered?.enabled ?? false);
  const handlers = note ? ownHandlersRef : registered?.handlers;

  useEffect(() => {
    const region = regionRef.current;
    if (!region || !enabled || !handlers) {
      return;
    }

    let staleTimer: number | undefined;

    const endDrag = () => {
      window.clearTimeout(staleTimer);
      staleTimer = undefined;
      dragDepthRef.current = 0;
      setIsDragging(false);
    };

    // `dragover` keeps firing while a drag is over the element, on a timer of
    // its own rather than on movement, so silence means the drag is gone:
    // dropped on another window, cancelled with Escape, or ended while this app
    // was behind another. Only the overlay rides on this -- a drop is handled
    // whether or not the overlay is up -- so clearing a beat early costs
    // nothing, while leaving it up leaves an overlay nobody can dismiss.
    const keepAlive = () => {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(endDrag, STALE_DRAG_MS);
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
        keepAlive();
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Clamped, because a drag already in flight when these listeners bind --
      // the tab was switched away and back mid-drag -- delivers a `dragleave`
      // whose `dragenter` went to nobody. Unclamped, the count passes zero on
      // the way down and never returns to it, which is an overlay that stays up
      // for the life of the region.
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        endDrag();
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      keepAlive();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      endDrag();

      if (!e.dataTransfer) {
        return;
      }

      // Split by what each item is rather than passing the whole file list on:
      // a folder rides in `dataTransfer.files` as well, so a drop mixing the two
      // would otherwise hand the folder to the file handler as a file with no
      // bytes behind it.
      const folders: DroppedFolder[] = [];
      const files = new DataTransfer();
      let sawFolder = false;

      for (const item of e.dataTransfer.items) {
        if (item.kind !== "file") {
          continue;
        }

        const isDirectory = item.webkitGetAsEntry()?.isDirectory ?? false;
        const file = item.getAsFile();

        if (!isDirectory) {
          if (file) {
            files.items.add(file);
          }
          continue;
        }

        sawFolder = true;
        const path = file ? window.api.getFilePath(file) : undefined;
        if (path) {
          folders.push({ path, type: "folder" });
        }
      }

      if (folders.length > 0) {
        handlers.current.onFoldersDropped?.(folders);
      } else if (sawFolder) {
        captureException(
          new Error("Could not get folder paths from dropped items"),
        );
      }

      if (files.files.length > 0) {
        handlers.current.onFilesDropped(files.files);
      }
    };

    region.addEventListener("dragenter", handleDragEnter);
    region.addEventListener("dragleave", handleDragLeave);
    region.addEventListener("dragover", handleDragOver);
    region.addEventListener("drop", handleDrop);

    return () => {
      endDrag();
      region.removeEventListener("dragenter", handleDragEnter);
      region.removeEventListener("dragleave", handleDragLeave);
      region.removeEventListener("dragover", handleDragOver);
      region.removeEventListener("drop", handleDrop);
    };
  }, [enabled, handlers]);

  return (
    // `isolate` so the overlay stacks against this region's own contents and
    // nothing else; see docs/findings/leaking-z-index-stacks.md.
    <div className={cn("relative isolate", className)} ref={regionRef}>
      <DropRegisterContext value={setRegistered}>
        {children}
      </DropRegisterContext>
      {isDragging && activeNote && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-brand-500/5">
          <span className="flex items-center gap-2 rounded-full bg-popover px-4 py-2 text-sm font-medium shadow-xl">
            <PaperclipIcon className="size-4 text-brand-600" />
            {activeNote}
          </span>
        </div>
      )}
    </div>
  );
}
