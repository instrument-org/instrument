import { afterEach, describe, expect, it, vi } from "vitest";

import { windowCamera } from "./window-camera";

vi.mock("electron", () => ({
  BrowserWindow: {},
  nativeImage: {},
  webContents: {},
}));
vi.mock("../browser-view/capture-frame", () => ({ captureFrame: vi.fn() }));
vi.mock("../lib/electron-logger", () => ({
  createScopedLogger: () => ({ info: vi.fn() }),
}));
vi.mock("./on-screen", () => ({ isDrivenInstance: () => false }));

const guest = vi.hoisted(() => ({
  contents: undefined as unknown,
  documents: new Map<unknown, string>(),
}));
vi.mock("../browser-view/guest-registry", () => ({
  guests: {
    documentOf: (_id: number, of: unknown) => guest.documents.get(of),
    records: () =>
      [{ contents: guest.contents, entry: { targetId: "tab_page" } }].values(),
  },
}));

const FIELD = { height: 0.25, width: 0.5, x: 0.25, y: 0.5 };

type Frame = {
  executeJavaScript: ReturnType<typeof vi.fn>;
  framesInSubtree: Frame[];
  origin: string;
  parent: Frame | null;
  url: string;
};

/** A frame whose page-world script answers `answer`. */
function frame(origin: string, parent: Frame | null, answer?: unknown): Frame {
  const made: Frame = {
    executeJavaScript: vi.fn(() =>
      answer === undefined ? new Promise(() => {}) : Promise.resolve(answer),
    ),
    framesInSubtree: [],
    origin,
    parent,
    url: `${origin}/`,
  };
  guest.documents.set(made, made.url);
  return made;
}

/** A guest whose main frame has `children`, its isolated world answering `isolated`. */
function page(isolated: Promise<unknown>, children: (main: Frame) => Frame[]) {
  const main = frame("https://example.com", null, []);
  main.framesInSubtree = [main, ...children(main)];
  const inIsolatedWorld = vi.fn(() => isolated);
  guest.contents = {
    executeJavaScriptInIsolatedWorld: inIsolatedWorld,
    id: 1,
    isDestroyed: () => false,
    mainFrame: main,
  };
  return { inIsolatedWorld, main };
}

afterEach(() => {
  guest.documents.clear();
  vi.useRealTimers();
});

describe("windowCamera.pageShows", () => {
  it("reads the main frame and its own origin's frames in a world apart from the page", async () => {
    const { inIsolatedWorld, main } = page(Promise.resolve([FIELD]), (top) => {
      const own = frame("https://example.com", top, []);
      return [own, frame("https://example.com", own, [])];
    });
    expect(await windowCamera.pageShows("tab_page")).toEqual({
      documents: [
        "https://example.com/",
        "https://example.com/",
        "https://example.com/",
      ],
      fields: [FIELD],
      hasFrameField: false,
    });
    expect(inIsolatedWorld).toHaveBeenCalledOnce();
    for (const each of main.framesInSubtree) {
      expect(each.executeJavaScript).not.toHaveBeenCalled();
    }
  });

  it("asks a frame of another origin, and one inside it, in their own", async () => {
    let inner: Frame | undefined;
    page(Promise.resolve([]), (top) => {
      const other = frame("https://ads.example", top, []);
      inner = frame("https://example.com", other, [FIELD]);
      return [other, inner];
    });
    expect(await windowCamera.pageShows("tab_page")).toMatchObject({
      hasFrameField: true,
    });
    expect(inner?.executeJavaScript).toHaveBeenCalledOnce();
  });

  it("asks a frame of an opaque origin in its own, even under a page of one", async () => {
    page(Promise.resolve([]), (top) => {
      top.origin = "null";
      return [frame("null", top, [FIELD])];
    });
    expect(await windowCamera.pageShows("tab_page")).toMatchObject({
      hasFrameField: true,
    });
  });

  it("counts a frame of another origin that never answers as one with a field", async () => {
    vi.useFakeTimers();
    page(Promise.resolve([]), (top) => [frame("https://ads.example", top)]);
    const shows = windowCamera.pageShows("tab_page");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await shows).toMatchObject({ hasFrameField: true });
  });

  it.each([
    ["never answers", () => new Promise(() => {})],
    ["answers out of shape", () => Promise.resolve([{ x: "0" }])],
    ["throws", () => Promise.reject(new Error("gone"))],
  ])("can't tell what a page shows whose main frame %s", async (_, answer) => {
    vi.useFakeTimers();
    page(answer(), () => []);
    const shows = windowCamera.pageShows("tab_page");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await shows).toBeUndefined();
  });
});
