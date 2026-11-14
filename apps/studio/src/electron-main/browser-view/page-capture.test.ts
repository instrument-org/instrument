import type { BrowserTargetId } from "@instrument-org/workspace/electron";
import type { WebContents } from "electron";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contents: new Map<number, unknown>(),
  ipc: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
  records: new Map<number, unknown>(),
  sites: {} as Record<string, unknown>,
}));

vi.mock("electron", () => ({
  app: { commandLine: { hasSwitch: () => true } },
  BrowserWindow: { fromWebContents: () => ({ isFocused: () => true }) },
  ipcMain: {
    on: (channel: string, handler: (event: unknown) => void) => {
      mocks.ipc.set(channel, handler);
    },
  },
  systemPreferences: {},
  webContents: { fromId: (id: number) => mocks.contents.get(id) },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/stores/workspace/site-capture", () => ({
  getSiteCaptureStore: () => ({
    get: () => mocks.sites,
    set: (_key: string, sites: Record<string, unknown>) => {
      mocks.sites = sites;
    },
  }),
}));
vi.mock("./guest-registry", () => ({
  guests: { get: (id: number) => mocks.records.get(id) },
}));
vi.mock("./log", () => ({ log: { info: vi.fn() } }));

const {
  answerAsk,
  anyPageCapturing,
  handleMediaRequest,
  isCapturing,
  listCaptures,
  listenForPageCapture,
  pauseCapture,
  stopCapture,
} = await import("./page-capture");
const { PAGE_CAPTURE_CHANNEL, PAGE_CAPTURE_STOP_CHANNEL } =
  await import("@/shared/page-editor-channels");

const PAGE = "https://page.example.com";
const WIDGET = "https://meet.example.com";

let nextId = 1;

/** A tab's guest a person is looking at and just clicked in, at `PAGE`. */
function guest() {
  const id = nextId++;
  // Cast: the id is a plain string in a test.
  const targetId = `tab_${id}` as BrowserTargetId;
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const listen = (name: string, handler: (...args: unknown[]) => void) => {
    handlers.set(name, handler);
  };
  const fake = {
    getURL: () => `${PAGE}/room`,
    hostWebContents: { isDestroyed: () => false },
    id,
    isDestroyed: () => false,
    on: listen,
    once: listen,
    reload: vi.fn(),
    send: vi.fn(),
  };
  mocks.contents.set(id, fake);
  mocks.records.set(id, {
    entry: { shown: true, targetId },
    role: "webview",
    userInputAt: Date.now(),
  });
  return {
    // Cast: only the members above are read.
    contents: fake as unknown as WebContents,
    emit: (name: string, ...args: unknown[]) => handlers.get(name)?.(...args),
    fake,
    targetId,
  };
}

/** A media request to the guest, settled once it is answered. */
function request(
  contents: WebContents,
  details: Parameters<typeof handleMediaRequest>[1],
) {
  return new Promise<boolean>((resolve) => {
    handleMediaRequest(contents, details, resolve);
  });
}

function report(contents: WebContents, kinds: string) {
  mocks.ipc.get(PAGE_CAPTURE_CHANNEL)?.({ sender: contents }, kinds);
}

const captureOf = (targetId: BrowserTargetId) =>
  listCaptures().find((each) => each.targetId === targetId);

describe("a frame's microphone and camera", () => {
  beforeEach(() => {
    mocks.sites = {
      [PAGE]: { audio: "allow", video: "allow" },
      [WIDGET]: { audio: "allow", video: "allow" },
    };
    listenForPageCapture();
  });

  it("counts what a frame was let have as in use, with no report from the page", async () => {
    const { contents, emit, targetId } = guest();

    expect(
      await request(contents, {
        isMainFrame: false,
        mediaTypes: ["audio"],
        securityOrigin: `${WIDGET}/`,
      }),
    ).toBe(true);

    expect(isCapturing(contents)).toBe(true);
    expect(anyPageCapturing()).toBe(true);
    expect(captureOf(targetId)).toMatchObject({
      pausable: false,
      using: { audio: true, video: false },
    });
    emit("did-navigate", {}, `${PAGE}/left`);
  });

  it("leaves a main frame's grant to the page's own report", async () => {
    const { contents, emit, targetId } = guest();

    await request(contents, {
      isMainFrame: true,
      mediaTypes: ["audio", "video"],
      securityOrigin: `${PAGE}/`,
    });

    expect(isCapturing(contents)).toBe(false);
    expect(captureOf(targetId)).toBeUndefined();
    report(contents, "audio,video");
    expect(captureOf(targetId)).toMatchObject({
      pausable: true,
      using: { audio: true, video: true },
    });
    report(contents, "");
    expect(isCapturing(contents)).toBe(false);
    emit("did-navigate", {}, `${PAGE}/left`);
  });

  it("keeps a frame's devices in use when the main frame reports its own tracks ended", async () => {
    const { contents, emit, targetId } = guest();
    await request(contents, {
      isMainFrame: true,
      mediaTypes: ["video"],
      securityOrigin: `${PAGE}/`,
    });
    await request(contents, {
      mediaTypes: ["audio"],
      securityOrigin: `${PAGE}/`,
    });
    report(contents, "video");
    expect(captureOf(targetId)?.using).toEqual({ audio: true, video: true });

    report(contents, "");

    expect(captureOf(targetId)?.using).toEqual({ audio: true, video: false });
    expect(isCapturing(contents)).toBe(true);
    emit("did-navigate", {}, `${PAGE}/left`);
  });

  it("clears a frame's devices when the tab loads another document", async () => {
    const { contents, emit, targetId } = guest();
    await request(contents, {
      isMainFrame: false,
      mediaTypes: ["audio"],
      securityOrigin: `${WIDGET}/`,
    });

    emit("did-navigate", {}, `${PAGE}/next`);

    expect(isCapturing(contents)).toBe(false);
    expect(anyPageCapturing()).toBe(false);
    expect(captureOf(targetId)).toBeUndefined();
  });

  it("forgets a guest's devices when it is destroyed", async () => {
    const { contents, emit } = guest();
    await request(contents, {
      isMainFrame: false,
      mediaTypes: ["audio"],
      securityOrigin: `${WIDGET}/`,
    });

    emit("destroyed");

    expect(isCapturing(contents)).toBe(false);
    expect(anyPageCapturing()).toBe(false);
  });

  it("stops a frame's capture by loading the page again, and does not pause it", async () => {
    const { contents, fake, targetId } = guest();
    await request(contents, {
      isMainFrame: false,
      mediaTypes: ["audio"],
      securityOrigin: `${WIDGET}/`,
    });

    pauseCapture(targetId, true);
    expect(captureOf(targetId)?.paused).toBe(false);
    expect(fake.send).not.toHaveBeenCalledWith(
      expect.stringContaining("pause"),
      true,
    );

    stopCapture(targetId);

    expect(fake.reload).toHaveBeenCalledOnce();
    expect(isCapturing(contents)).toBe(false);
  });

  it("stops a main frame's capture through its preload, with no reload", async () => {
    const { contents, emit, fake, targetId } = guest();
    await request(contents, {
      isMainFrame: true,
      mediaTypes: ["audio"],
      securityOrigin: `${PAGE}/`,
    });
    report(contents, "audio");

    stopCapture(targetId);

    expect(fake.send).toHaveBeenCalledWith(PAGE_CAPTURE_STOP_CHANNEL);
    expect(fake.reload).not.toHaveBeenCalled();
    emit("did-navigate", {}, `${PAGE}/left`);
  });

  it("counts a frame's devices once the person answers its ask", async () => {
    mocks.sites = {};
    const { contents, emit, targetId } = guest();
    const answered = request(contents, {
      isMainFrame: false,
      mediaTypes: ["audio"],
      securityOrigin: `${WIDGET}/`,
    });
    expect(captureOf(targetId)?.ask).toEqual({ audio: true, video: false });
    expect(isCapturing(contents)).toBe(false);

    answerAsk(targetId, { answer: "once", devices: {} });

    expect(await answered).toBe(true);
    expect(isCapturing(contents)).toBe(true);
    emit("did-navigate", {}, `${PAGE}/left`);
  });

  it("refuses a frame no person just clicked in, and counts nothing", async () => {
    mocks.sites = {};
    const { contents, targetId } = guest();
    mocks.records.set(contents.id, {
      entry: { shown: true, targetId },
      role: "webview",
      userInputAt: 0,
    });

    expect(
      await request(contents, {
        isMainFrame: false,
        mediaTypes: ["audio"],
        securityOrigin: `${WIDGET}/`,
      }),
    ).toBe(false);

    expect(isCapturing(contents)).toBe(false);
  });
});
