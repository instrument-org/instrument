import {
  dragAtom,
  useDropTarget,
} from "@/client/components/window/drag/session";
import { DROP_LOOK } from "@/client/components/window/drag/tone";
import { placeOf } from "@/client/components/window/drag/types";
import { type DropHandlers } from "@/client/hooks/use-file-drop-region";
import {
  isSelfFileDrag,
  releaseSelfFileDrag,
} from "@/client/lib/self-file-drag";
import { captureException } from "@/client/lib/capture-exception";
import { splitTransferItems } from "@/client/lib/transfer-items";
import { cn } from "@/client/lib/utils";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

// How long the overlay survives without a `dragover`. Generous, because the
// only cost of waiting is an overlay that lingers a moment after a drag it
// never saw end, and the cost of being wrong the other way is an overlay taken
// down while the file is still in the air.
const STALE_DRAG_MS = 1000;

/**
 * A box that takes a dropped file, the composer's, and the only thing that
 * says so: its own outline, a little outside it, so the rest of the page
 * around it still takes what is held as the page does (a side, a split).
 * A place of Files' sidebar or Files menu held by the window's own drag goes
 * in as the folder it names, the way that folder dragged from Files' listing
 * does, under the same outline.
 */
export function FileDropRegion({
  children,
  className,
  enabled = true,
  note,
  onFilesDropped,
  onFoldersDropped,
}: DropHandlers & {
  children: ReactNode;
  className?: string;
  // Off where the box is not in front: every open tab stays mounted in one
  // web contents, so without this a single drop fans out to every tab's
  // composer.
  enabled?: boolean;
  note: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const box = useId();
  const landing = useAtomValue(dragAtom)?.landing;
  // A place the window's drag holds, over this box.
  const isPlaceHere = landing?.kind === "attach" && landing.box === box;
  // Where the window's drag has a landing of its own (a split target drawn
  // over the box), letting go goes there, so the box says nothing.
  const isTakenElsewhere = landing !== undefined && !isPlaceHere;
  const regionRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);

  // The handlers are rebuilt every render (one closes over the attachment
  // list), so they are read through a ref: binding them would rebind the
  // region's listeners mid-drag.
  const handlers = useRef<DropHandlers>({ onFilesDropped, onFoldersDropped });

  useEffect(() => {
    handlers.current = { onFilesDropped, onFoldersDropped };
  });

  useDropTarget(
    enabled && onFoldersDropped
      ? {
          land: (held) => {
            const place = placeOf(held);
            if (place) {
              handlers.current.onFoldersDropped?.([
                { path: place.path, type: "folder" },
              ]);
            }
          },
          landingAt: (_, { held }) =>
            placeOf(held) ? { box, kind: "attach" } : undefined,
          rect: ({ held }) => {
            const region = regionRef.current;
            if (!placeOf(held) || !region?.checkVisibility()) {
              return undefined;
            }
            const { height, left, top, width } = region.getBoundingClientRect();
            return width > 0 && height > 0
              ? { height, left, top, width }
              : undefined;
          },
        }
      : undefined,
  );

  useEffect(() => {
    const region = regionRef.current;
    if (!region || !enabled) {
      return;
    }

    let staleTimer: number | undefined;

    const endDrag = () => {
      window.clearTimeout(staleTimer);
      staleTimer = undefined;
      dragDepthRef.current = 0;
      setIsDragging(false);
      // Every way a drag ends passes through here, including leaving the
      // window, which is what makes coming back afterwards count as deliberate.
      releaseSelfFileDrag();
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
      // Counted but not drawn: the depth has to stay balanced against the
      // leave that follows, while a ring would be offering to take a file this
      // app is in the middle of handing out.
      if (e.dataTransfer?.types.includes("Files") && !isSelfFileDrag(region)) {
        setIsDragging(true);
        keepAlive();
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // A `dragleave` whose `dragenter` went to nobody is not this drag ending,
      // and there are two ways to receive one: listeners that bound while a
      // drag was already in flight, and the moment this app hands the OS a
      // drag of its own. Both are read the same way -- the count is clamped
      // rather than passing below zero, where it would never return and strand
      // the overlay, and a leave that was never entered ends nothing.
      const wasInside = dragDepthRef.current > 0;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (wasInside && dragDepthRef.current === 0) {
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
      // Read before `endDrag`, which is what clears it.
      const isOwnDrag = isSelfFileDrag(region);
      endDrag();

      // A file this app put in the air, let go again without ever leaving the
      // window. Attaching a chat's own file to that same chat is not what
      // anyone was reaching for; a click that moved far enough to drag is.
      if (isOwnDrag || !e.dataTransfer) {
        return;
      }

      // Split by what each item is rather than passing the whole file list on:
      // a folder rides in `dataTransfer.files` as well, so a drop mixing the two
      // would otherwise hand the folder to the file handler as a file with no
      // bytes behind it.
      const { files, folders, unresolvedFolders } = splitTransferItems({
        getFilePath: window.api.getFilePath,
        items: e.dataTransfer.items,
      });

      if (folders.length > 0) {
        handlers.current.onFoldersDropped?.(folders);
      } else if (unresolvedFolders > 0) {
        captureException(
          new Error("Could not get folder paths from dropped items"),
        );
      }

      if (files.length > 0) {
        const fileList = new DataTransfer();
        for (const file of files) {
          fileList.items.add(file);
        }
        handlers.current.onFilesDropped(fileList.files);
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
  }, [enabled]);

  return (
    // `isolate` so the overlay stacks against this region's own contents and
    // nothing else; see docs/findings/leaking-z-index-stacks.md.
    <div
      className={cn("relative isolate", className)}
      // Where a side's page leaves files to this region rather than opening
      // them as tabs (`useSidePagesTarget`).
      {...(enabled ? { "data-file-drop-region": "" } : {})}
      ref={regionRef}
    >
      {children}
      {((isDragging && !isTakenElsewhere) || isPlaceHere) && (
        <div
          className={cn(
            "pointer-events-none absolute -inset-1.5 z-10 flex items-center justify-center rounded-[26px]",
            DROP_LOOK.attach,
          )}
        >
          <span className="flex items-center gap-2 rounded-full bg-popover px-4 py-2 text-sm font-medium shadow-float-lg">
            <PaperclipIcon className="size-4 text-brand-600" />
            {note}
          </span>
        </div>
      )}
    </div>
  );
}
