import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SceneElement } from "./scene-sync";

const files = vi.hoisted(() => ({
  read: { call: vi.fn() },
  write: { call: vi.fn() },
}));

vi.mock("@/client/rpc/client", () => ({ rpcClient: { files } }));

// Text measures 10 wide before the canvas's fonts load and 12 after, the way
// Excalidraw's own measuring moves once its fonts are in.
const fonts = vi.hoisted(() => ({ loaded: false }));

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER" },
  FONT_FAMILY: { Excalifont: 5 },
  restoreElements: (
    raw: Record<string, unknown>[],
    _local: unknown,
    options?: { refreshDimensions?: boolean },
  ) =>
    raw.map((element) => ({
      angle: 0,
      isDeleted: false,
      version: 1,
      versionNonce: 1,
      ...element,
      ...(element.type === "text" && options?.refreshDimensions
        ? { width: fonts.loaded ? 12 : 10 }
        : {}),
    })),
  serializeAsJSON: () => {
    throw new Error("Every save in these tests splices the file");
  },
}));

import { createExcalidrawSession, readDiskScene } from "./excalidraw-session";

/** A file's JSON, as the tests read it back (`as`: JSON.parse returns `any`). */
function parsed(text: string) {
  return JSON.parse(text) as {
    appState: Record<string, unknown>;
    elements: SceneElement[];
  };
}

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  height: 50,
  id,
  type: "rectangle",
  version: 3,
  versionNonce: 7,
  width: 100,
  x: 0,
  y: 0,
  ...extra,
});

const text = (id: string) => ({
  fontFamily: 5,
  height: 20,
  id,
  text: "hi",
  type: "text",
  version: 3,
  versionNonce: 7,
  width: 10,
  x: 0,
  y: 0,
});

const file = (elements: unknown[], background = "#ffffff") =>
  JSON.stringify(
    {
      appState: { viewBackgroundColor: background },
      elements,
      files: {},
      type: "excalidraw",
      version: 2,
    },
    null,
    2,
  );

/** Stands in for the canvas: what Excalidraw's imperative API reads and takes. */
function fakeCanvas(content: string) {
  const scene = readDiskScene(content);
  if (!scene) {
    throw new Error("not a scene");
  }
  const state = {
    appState: {
      cursorButton: "up",
      newElement: null,
      viewBackgroundColor: scene.settings.viewBackgroundColor ?? "#ffffff",
    } as Record<string, unknown>,
    elements: scene.elements as SceneElement[],
    files: {} as Record<string, unknown>,
  };
  const api = {
    addFiles: (added: { id: string }[]) => {
      for (const one of added) {
        state.files[one.id] = one;
      }
    },
    getAppState: () => state.appState,
    getFiles: () => state.files,
    getSceneElements: () => state.elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => state.elements,
    updateScene: (update: {
      appState?: Record<string, unknown>;
      elements?: SceneElement[];
    }) => {
      if (update.elements) {
        state.elements = update.elements;
      }
      if (update.appState) {
        state.appState = { ...state.appState, ...update.appState };
      }
    },
  };
  const report = () => ({
    appState: state.appState,
    elements: state.elements,
    files: state.files,
  });
  return { api, report, scene, state };
}

function open(content: string) {
  const canvas = fakeCanvas(content);
  const onExternalChange = vi.fn();
  const session = createExcalidrawSession({
    // The fake answers every call the session makes (`as`: the real type is
    // Excalidraw's whole imperative API).
    api: canvas.api as unknown as Parameters<
      typeof createExcalidrawSession
    >[0]["api"],
    hostPath: "/w/Board.excalidraw",
    initial: { scene: canvas.scene, version: "v1" },
    onExternalChange,
    onStatus: () => {},
  });
  const edit = (change: (elements: SceneElement[]) => SceneElement[]) => {
    canvas.state.elements = change(canvas.state.elements);
    session.onCanvasChange(
      canvas.report() as unknown as Parameters<
        typeof session.onCanvasChange
      >[0],
    );
  };
  return { canvas, edit, onExternalChange, session };
}

const moved = (id: string, x: number) => (elements: SceneElement[]) =>
  elements.map((element) =>
    element.id === id
      ? { ...element, version: (element.version ?? 0) + 1, x }
      : element,
  );

beforeEach(() => {
  fonts.loaded = false;
  files.read.call.mockReset();
  files.write.call.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
});

describe("createExcalidrawSession", () => {
  it("merges an agent's write on close against the canvas as last reported", async () => {
    const start = file([rect("a"), rect("b")]);
    const { canvas, edit, session } = open(start);
    edit(moved("a", 10));
    const theirs = file([rect("a"), rect("b", { version: 4, x: 50 })]);
    files.write.call
      .mockResolvedValueOnce({ content: theirs, ok: false, version: "v2" })
      .mockResolvedValue({ ok: true, version: "v3" });
    // Excalidraw empties its scene as it unmounts, before the close's save.
    canvas.state.elements = [];

    await session.destroy();

    const last = files.write.call.mock.lastCall?.[0] as { content: string };
    const xs = Object.fromEntries(
      parsed(last.content).elements.map((element) => [element.id, element.x]),
    );
    expect(xs).toEqual({ a: 10, b: 50 });
  });

  it("writes a background changed while a save was in flight", async () => {
    const { canvas, edit, session } = open(file([rect("a")]));
    let land!: (value: unknown) => void;
    files.write.call
      .mockReturnValueOnce(
        new Promise((resolve) => {
          land = resolve;
        }),
      )
      .mockResolvedValue({ ok: true, version: "v3" });
    edit(moved("a", 10));
    const first = session.flush();
    await vi.waitFor(() => {
      expect(files.write.call).toHaveBeenCalledTimes(1);
    });
    canvas.state.appState = {
      ...canvas.state.appState,
      viewBackgroundColor: "#000000",
    };
    edit((elements) => elements);
    land({ ok: true, version: "v2" });
    await first;
    await session.flush();

    const last = files.write.call.mock.lastCall?.[0] as { content: string };
    expect(parsed(last.content).appState.viewBackgroundColor).toBe("#000000");
  });

  it("drops a text the agent deleted once the canvas's fonts have loaded", async () => {
    let fontsIn!: () => void;
    // jsdom has no font loading.
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        load: () =>
          new Promise((resolve) => {
            fontsIn = () => {
              fonts.loaded = true;
              resolve([]);
            };
          }),
      },
    });
    const { canvas, onExternalChange, session } = open(file([text("t")]));
    await vi.waitFor(() => {
      expect(fontsIn).toBeDefined();
    });
    fontsIn();
    await vi.waitFor(() => {
      expect(canvas.state.elements[0]?.width).toBe(12);
    });
    files.read.call.mockResolvedValue({ content: file([]), version: "v2" });
    files.write.call.mockResolvedValue({ ok: true, version: "v3" });

    session.pull();
    await session.flush();

    expect(canvas.api.getSceneElements()).toEqual([]);
    expect(onExternalChange).toHaveBeenCalledWith({ changed: 1, conflicts: 0 });
  });
});
