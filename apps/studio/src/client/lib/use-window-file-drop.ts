import { useEffect, useRef, useState } from "react";

import { captureException } from "./telemetry";

export interface DroppedFolder {
  path: string;
  type: "folder";
}

interface UseWindowFileDropOptions {
  // Gates the window listeners so only the active tab reacts. Every open tab
  // stays mounted in one web contents, so without this a single drop fans out
  // to every tab's PromptInput.
  enabled?: boolean;
  onFilesDropped: (files: FileList) => void;
  onFoldersDropped?: (folders: DroppedFolder[]) => void;
}

export const useWindowFileDrop = ({
  enabled = true,
  onFilesDropped,
  onFoldersDropped,
}: UseWindowFileDropOptions) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
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
      dragCounterRef.current = 0;

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
          onFoldersDropped?.(folders);
        } else {
          captureException(
            new Error("Could not get folder paths from dropped items"),
          );
        }
      }

      if (fileItems.length > 0 && files.length > 0) {
        onFilesDropped(files);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [enabled, onFilesDropped, onFoldersDropped]);

  return { isDragging: enabled && isDragging };
};
