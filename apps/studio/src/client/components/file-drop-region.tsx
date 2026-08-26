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

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current--;
      if (dragDepthRef.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragDepthRef.current = 0;

      if (!e.dataTransfer) {
        return;
      }

      const items = [...e.dataTransfer.items];
      const files = e.dataTransfer.files;

      const folderItems = items.filter(
        (item) => item.webkitGetAsEntry()?.isDirectory,
      );

      const fileItems = items.filter(
        (item) => !item.webkitGetAsEntry()?.isDirectory,
      );

      if (folderItems.length > 0) {
        const folders: DroppedFolder[] = [];

        for (const folderItem of folderItems) {
          if (folderItem.kind === "file") {
            const file = folderItem.getAsFile();
            if (file) {
              const path = window.api.getFilePath(file);
              if (path) {
                folders.push({ path, type: "folder" });
              }
            }
          }
        }

        if (folders.length > 0) {
          handlers.current.onFoldersDropped?.(folders);
        } else {
          captureException(
            new Error("Could not get folder paths from dropped items"),
          );
        }
      }

      if (fileItems.length > 0 && files.length > 0) {
        handlers.current.onFilesDropped(files);
      }
    };

    region.addEventListener("dragenter", handleDragEnter);
    region.addEventListener("dragleave", handleDragLeave);
    region.addEventListener("dragover", handleDragOver);
    region.addEventListener("drop", handleDrop);

    return () => {
      dragDepthRef.current = 0;
      setIsDragging(false);
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
