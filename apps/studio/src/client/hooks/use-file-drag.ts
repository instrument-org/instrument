import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { trackSelfFileDrag } from "@/client/lib/self-file-drag";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { type DragEvent } from "react";

export type FileDragProps = ReturnType<typeof useFileDrag>;

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

// Starting a drag cannot wait on anything, so the main process resolves the
// file and renders its drag image before the gesture (see
// electron-main/lib/file-drag). Deduped only while a request is open, not by
// result: the point of asking again on press is that the answer is current.
const preparing = new Map<string, Promise<unknown>>();

/**
 * Props that make an element a handle for dragging a task file out to the
 * desktop, the way a file in Finder or File Explorer drags.
 *
 * Spread onto whatever the user would grab. `draggable` is false outside
 * Electron, where there is no host path to hand anyone, and for a surface that
 * cannot name a file on disk -- a header drawn before the file resolved, a
 * markdown image whose source is a real URL rather than a task path. The
 * element is simply not draggable rather than starting a drag that carries
 * nothing.
 */
export function useFileDrag(file: FileRef | undefined) {
  const canDrag = Boolean(file && window.api.startFileDrag);

  return {
    draggable: canDrag,
    onDragStart: (event: DragEvent) => {
      if (!file) {
        return;
      }
      // Left alone, the browser drags its own idea of the element: a thumbnail's
      // image URL, or nothing at all. Neither means anything to another app, so
      // this cancels it and the main process starts a real file drag in its
      // place.
      event.preventDefault();
      // Marked before the drag exists rather than after, so a release quick
      // enough to beat the OS still finds the flag set.
      trackSelfFileDrag();
      window.api.startFileDrag?.([
        { filePath: file.filePath, taskId: file.taskId },
      ]);
    },
    // Hover is what makes the first drag work: the icon behind it is rendered
    // by the OS, which is far slower than the few pixels of movement between
    // pressing and dragging.
    onPointerDown: () => {
      void prepare(file);
    },
    onPointerEnter: () => {
      void prepare(file);
    },
  };
}

function prepare(file: FileRef | undefined) {
  if (!file) {
    return;
  }

  const key = `${file.taskId} ${file.filePath}`;
  const open = preparing.get(key);
  if (open) {
    return open;
  }

  const request = safe(
    rpcClient.utils.prepareTaskFileDrag.call({
      filePath: file.filePath,
      id: file.taskId,
    }),
  ).finally(() => {
    preparing.delete(key);
  });

  preparing.set(key, request);
  return request;
}
