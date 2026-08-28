import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { trackSelfFileDrag } from "@/client/lib/self-file-drag";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import {
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";

export type FileDragProps = ReturnType<typeof useFileDrag>;

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

// Starting a drag cannot wait on anything, so the main process resolves the
// file and renders its drag image before the gesture (see
// electron-main/lib/file-drag). Deduped only while a request is open, not by
// result: the point of asking again on press is that the answer is current.
const preparing = new Map<string, Promise<unknown>>();

// How far the pointer travels before a press is read as a drag. Blink's own
// threshold is a few pixels, which is well inside the drift of an ordinary
// click: at that distance clicking a file card put a drag icon on the cursor
// and swallowed the click that would have opened it. A press only becomes a
// drag once it has gone somewhere a click does not go.
const DRAG_THRESHOLD_PX = 20;

interface Gesture {
  // Whether Blink agreed this press is a drag. It decides that at its own
  // threshold, well before ours, and the gesture waits for both.
  armed: boolean;
  originX: number;
  originY: number;
  teardown: () => void;
}

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
  // Cancelling the dragstart keeps Blink out of a drag state, so it never
  // applies its own rule that a drag suppresses the click after it. A press and
  // release on one element is a click by every measure Blink has left, which
  // made dropping a file back onto the card it came from open that card.
  const draggedRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);

  const endGesture = () => {
    gestureRef.current?.teardown();
    gestureRef.current = null;
  };

  // A press that is still open when the surface goes away would otherwise leave
  // its listeners on the window.
  useEffect(() => endGesture, []);

  const beginDrag = () => {
    if (!file) {
      return;
    }
    endGesture();
    // Both set before the drag exists rather than after, so a release quick
    // enough to beat the OS still finds them.
    trackSelfFileDrag();
    draggedRef.current = true;
    window.api.startFileDrag?.([
      { filePath: file.filePath, taskId: file.taskId },
    ]);
  };

  return {
    draggable: canDrag,
    onClickCapture: (event: MouseEvent) => {
      if (!draggedRef.current) {
        return;
      }
      // Capture, so this runs before whatever the surface does on click, and
      // cleared here rather than on a timer: the click is the end of the
      // gesture that set it.
      draggedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event: DragEvent) => {
      // Cancelled either way: left alone Blink drags its own idea of the
      // element, a thumbnail's image URL or nothing at all, and neither means
      // anything to another app. What it does not do any more is start the real
      // drag, which waits for the pointer to travel far enough to mean it.
      event.preventDefault();
      const gesture = gestureRef.current;
      if (gesture) {
        gesture.armed = true;
      }
    },
    onPointerDown: (event: ReactPointerEvent) => {
      // A fresh press is a fresh gesture, whatever the last one turned into.
      draggedRef.current = false;
      endGesture();
      // Hover is what makes the first drag work: the icon behind it is rendered
      // by the OS, which is far slower than the few pixels of movement between
      // pressing and dragging.
      void prepare(file);

      if (!canDrag) {
        return;
      }

      const handleEnd = () => {
        endGesture();
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const gesture = gestureRef.current;
        if (!gesture?.armed) {
          return;
        }
        const dx = moveEvent.clientX - gesture.originX;
        const dy = moveEvent.clientY - gesture.originY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return;
        }
        beginDrag();
      };

      gestureRef.current = {
        armed: false,
        originX: event.clientX,
        originY: event.clientY,
        teardown: () => {
          window.removeEventListener("pointercancel", handleEnd);
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleEnd);
        },
      };

      window.addEventListener("pointercancel", handleEnd);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
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
