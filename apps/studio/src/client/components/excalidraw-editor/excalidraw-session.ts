// One drawing's disk I/O: the canvas's edits saved debounced and
// version-checked, and the agent's writes merged into the canvas as they land
// (scene-sync.ts). Everything that touches the disk runs through the same
// queue the other live editors use, so a merge never interleaves with a save.
import {
  createSaveQueue,
  flushOnLeave,
  type SaveStatus,
} from "@/client/lib/live-file";
import { rpcClient } from "@/client/rpc/client";
import {
  CaptureUpdateAction,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { type ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  type DiskScene,
  mergeScene,
  newFiles,
  readScene,
  type Restore,
  type SceneElement,
  type SceneFile,
  spliceScene,
} from "./scene-sync";

/** How long a merge waits for the pointer to come up before trying again. */
const BUSY_RETRY_MS = 250;

// Excalidraw's element and file types are closed unions; the merge layer
// reads them as open records, which is what they are on disk.
const restore: Restore = (raw) =>
  restoreElements(
    raw.map(sizedText) as unknown as Parameters<typeof restoreElements>[0],
    null,
    { refreshDimensions: true, repairBindings: true },
  ) as unknown as readonly SceneElement[];

/**
 * A text an agent wrote with no size is dropped by `restoreElements` as
 * invisibly small; given a placeholder one, it is measured instead.
 */
function sizedText(element: SceneElement): SceneElement {
  if (
    element.type !== "text" ||
    (typeof element.width === "number" && element.width > 0)
  ) {
    return element;
  }
  return { ...element, height: 1, width: 1 };
}

type Api = ExcalidrawImperativeAPI;
type CanvasElements = Parameters<Api["updateScene"]>[0]["elements"];

export type ExcalidrawSession = ReturnType<typeof createExcalidrawSession>;

export function createExcalidrawSession(options: {
  api: Api;
  hostPath: string;
  initial: { scene: DiskScene; version: string };
  /** The agent's write reached the canvas; `conflicts` counts where the person's edit was kept over it. */
  onExternalChange: (change: { changed: number; conflicts: number }) => void;
  onStatus: (status: SaveStatus, detail?: string) => void;
}) {
  const { api, hostPath } = options;
  let disk = { scene: options.initial.scene, version: options.initial.version };
  let destroyed = false;
  let seenVersion = sceneVersion(api.getSceneElementsIncludingDeleted());
  let busyTimer: ReturnType<typeof setTimeout> | undefined;

  const saves = createSaveQueue({
    label: "excalidraw editor",
    onStatus: options.onStatus,
    save,
  });

  const canvasText = () => {
    const elements =
      api.getSceneElementsIncludingDeleted() as unknown as readonly SceneElement[];
    const files = api.getFiles() as unknown as Record<string, SceneFile>;
    return (
      spliceScene({ disk: disk.scene, elements, files }) ??
      serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      )
    );
  };

  async function save() {
    const text = canvasText();
    if (text === disk.scene.text) {
      options.onStatus("saved");
      return;
    }
    options.onStatus("saving");
    const result = await rpcClient.files.write.call({
      baseVersion: disk.version,
      content: text,
      path: hostPath,
    });
    if (result.ok) {
      disk = {
        scene: readScene(text, restore) ?? disk.scene,
        version: result.version,
      };
      options.onStatus("saved");
      if (!destroyed && canvasText() !== disk.scene.text) {
        saves.schedule();
      }
      return;
    }
    // The file changed since the canvas last read it: merge, then save again.
    mergeIn(result.content, result.version);
    saves.schedule(100);
  }

  /** Whether the person is mid-gesture: a drag, a resize, a shape being drawn. */
  const busy = () => {
    const state = api.getAppState();
    return state.cursorButton === "down" || state.newElement !== null;
  };

  function mergeIn(content: string, version: string) {
    const theirs = readScene(content, restore);
    // Half written, or not a drawing: the next write is read instead.
    if (!theirs) {
      return;
    }
    const merged = mergeScene({
      base: disk.scene.elements,
      ours: api.getSceneElementsIncludingDeleted() as unknown as readonly SceneElement[],
      theirs: theirs.elements,
    });
    const files = newFiles({ ours: api.getFiles(), theirs: theirs.files });
    disk = { scene: theirs, version };
    if (files.length > 0) {
      api.addFiles(files as unknown as Parameters<Api["addFiles"]>[0]);
    }
    if (merged.changed.length > 0) {
      seenVersion = sceneVersion(merged.elements);
      // Outside undo history, with no app state, so the view and the
      // selection stay where the person left them.
      api.updateScene({
        captureUpdate: CaptureUpdateAction.NEVER,
        elements: merged.elements as unknown as CanvasElements,
      });
      options.onExternalChange({
        changed: merged.changed.length,
        conflicts: merged.conflicts,
      });
    }
    // Whatever the person had unsaved is now unsaved against the new text.
    saves.schedule();
  }

  /** The file changed on disk (or may have): read it and merge what changed. */
  const pull = () => {
    if (destroyed) {
      return;
    }
    saves.pull(async () => {
      const result = await rpcClient.files.read.call({ path: hostPath });
      // Our own save's echo.
      if (
        destroyed ||
        result.version === disk.version ||
        result.content === disk.scene.text
      ) {
        return;
      }
      if (busy()) {
        clearTimeout(busyTimer);
        busyTimer = setTimeout(pull, BUSY_RETRY_MS);
        return;
      }
      mergeIn(result.content, result.version);
    });
  };

  /** The canvas changed; a scroll or a selection is not a change to the file. */
  const onCanvasChange = (elements: readonly { version: number }[]) => {
    if (destroyed) {
      return;
    }
    const version = sceneVersion(elements);
    if (version === seenVersion) {
      return;
    }
    seenVersion = version;
    saves.schedule();
  };

  const stopFlushOnLeave = flushOnLeave(saves.flush);

  return {
    canvasText,
    /** Saves what is unsaved, then stops. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      stopFlushOnLeave();
      clearTimeout(busyTimer);
      await saves.flush();
      destroyed = true;
      saves.cancel();
    },
    disk: () => disk,
    flush: saves.flush,
    onCanvasChange,
    pull,
    /** Saves again now, after a save that failed. */
    retrySave: () => {
      saves.schedule(0);
    },
  };
}

export function readDiskScene(text: string) {
  return readScene(text, restore);
}

/** Sum of element versions: moves with every edit, and not with a scroll. */
function sceneVersion(elements: readonly { version?: number }[]) {
  let sum = 0;
  for (const element of elements) {
    sum += element.version ?? 0;
  }
  return sum;
}
