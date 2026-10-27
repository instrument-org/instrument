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
  FONT_FAMILY,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { type ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  changedSettings,
  type DiskScene,
  mergeScene,
  newFiles,
  readScene,
  type Restore,
  type SceneElement,
  type SceneFile,
  type SceneSettings,
  settingsOf,
  sizedText,
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
  let closing = false;
  let seenVersion = sceneVersion(api.getSceneElementsIncludingDeleted());
  // The board's settings as the canvas had them when it last matched the
  // file: what differs from these is the person's change to write. Read off
  // the canvas rather than the file, so a default the file leaves out is not
  // taken for an edit.
  let syncedSettings: SceneSettings = settingsOf(api.getAppState());
  let seenSettings = JSON.stringify(syncedSettings);
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  // The canvas as it last reported itself, which is what a save writes:
  // Excalidraw empties its scene as it unmounts, before the save on close
  // runs, so reading the canvas then would find nothing to write.
  let canvas = readCanvas();

  const saves = createSaveQueue({
    label: "excalidraw editor",
    onStatus: options.onStatus,
    save,
  });

  function readCanvas() {
    return {
      appState: api.getAppState(),
      elements: api.getSceneElementsIncludingDeleted(),
      files: api.getFiles(),
    };
  }

  const canvasText = () =>
    spliceScene({
      disk: disk.scene,
      elements: canvas.elements as unknown as readonly SceneElement[],
      files: canvas.files as unknown as Record<string, SceneFile>,
      settings: changedSettings(syncedSettings, settingsOf(canvas.appState)),
    }) ??
    serializeAsJSON(
      canvas.elements.filter((element) => !element.isDeleted),
      canvas.appState,
      canvas.files,
      "local",
    );

  async function save() {
    const text = canvasText();
    // What `text` was made from: a change made while the write is out is
    // still the person's to write next.
    const settings = settingsOf(canvas.appState);
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
      syncedSettings = settings;
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

  /**
   * The canvas after a merge changed it: read back off Excalidraw, which
   * indexes what it takes, or as handed to it once the board is closing,
   * when Excalidraw has already emptied its scene.
   */
  function settleCanvas(handed: typeof canvas) {
    canvas = closing ? handed : readCanvas();
  }

  function mergeIn(content: string, version: string) {
    const theirs = readScene(content, restore);
    // Half written, or not a drawing: the next write is read instead.
    if (!theirs) {
      return;
    }
    const merged = mergeScene({
      base: disk.scene.elements,
      ours: canvas.elements as unknown as readonly SceneElement[],
      theirs: theirs.elements,
    });
    const files = newFiles({ ours: canvas.files, theirs: theirs.files });
    // The agent's settings, where the person left theirs as they were.
    const canvasSettings = settingsOf(canvas.appState);
    const personChanged = changedSettings(syncedSettings, canvasSettings);
    const agentChanged = Object.fromEntries(
      Object.entries(
        changedSettings(disk.scene.settings, theirs.settings),
      ).filter(([key]) => !(key in personChanged)),
    );
    disk = { scene: theirs, version };
    if (files.length > 0) {
      const added = files as unknown as Parameters<Api["addFiles"]>[0];
      api.addFiles(added);
      settleCanvas({
        ...canvas,
        files: {
          ...canvas.files,
          ...Object.fromEntries(added.map((file) => [file.id, file])),
        },
      });
    }
    if (Object.keys(agentChanged).length > 0) {
      syncedSettings = { ...syncedSettings, ...agentChanged };
      seenSettings = JSON.stringify(
        settingsOf({ ...canvasSettings, ...agentChanged }),
      );
      const appState = agentChanged as Parameters<
        Api["updateScene"]
      >[0]["appState"];
      api.updateScene({
        appState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      settleCanvas({
        ...canvas,
        appState: { ...canvas.appState, ...appState },
      });
    }
    if (merged.changed.length > 0) {
      seenVersion = sceneVersion(merged.elements);
      // Outside undo history, with no app state, so the view and the
      // selection stay where the person left them.
      api.updateScene({
        captureUpdate: CaptureUpdateAction.NEVER,
        elements: merged.elements as unknown as CanvasElements,
      });
      settleCanvas({
        ...canvas,
        elements: merged.elements as unknown as typeof canvas.elements,
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
  const onCanvasChange = (reported: ReturnType<typeof readCanvas>) => {
    if (destroyed) {
      return;
    }
    canvas = reported;
    const version = sceneVersion(reported.elements);
    const settings = JSON.stringify(settingsOf(reported.appState));
    if (version === seenVersion && settings === seenSettings) {
      return;
    }
    seenVersion = version;
    seenSettings = settings;
    saves.schedule();
  };

  const stopFlushOnLeave = flushOnLeave(saves.flush);

  /**
   * Text is measured when it is restored, which on open is before the canvas
   * has loaded its fonts, so a text sized by whoever wrote the file (an agent
   * measuring with some other font) or by the fallback font comes out clipped.
   * Once the fonts the drawing uses are in, every text is measured again. The
   * versions stay as they are, so this alone is no edit and saves nothing.
   */
  async function remeasureTextOnceFontsLoad() {
    const names = new Map(
      Object.entries(FONT_FAMILY).map(([name, id]) => [id, name]),
    );
    const used = new Set<string>();
    for (const element of api.getSceneElements()) {
      const name =
        element.type === "text" ? names.get(element.fontFamily) : undefined;
      if (name) {
        used.add(name);
      }
    }
    if (used.size === 0) {
      return;
    }
    await Promise.all(
      [...used].map((name) =>
        document.fonts.load(`20px "${name}"`).catch(() => []),
      ),
    );
    if (destroyed) {
      return;
    }
    const elements = api.getSceneElementsIncludingDeleted();
    const measured = restoreElements(elements, null, {
      refreshDimensions: true,
    });
    const resized = measured.some(
      (element, index) =>
        element.width !== elements[index]?.width ||
        element.height !== elements[index]?.height,
    );
    if (resized) {
      api.updateScene({
        captureUpdate: CaptureUpdateAction.NEVER,
        elements: measured,
      });
      canvas = readCanvas();
      // The file read again with the fonts in, so the merge's base measures
      // as the canvas now does and a resized text is no edit of the person's.
      disk = {
        ...disk,
        scene: readScene(disk.scene.text, restore) ?? disk.scene,
      };
    }
  }
  void remeasureTextOnceFontsLoad();

  return {
    canvasText,
    /** Saves what is unsaved, then stops. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      closing = true;
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
