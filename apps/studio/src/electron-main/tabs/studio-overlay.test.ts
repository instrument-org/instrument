import type { BaseWindow } from "electron";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/electron-main/lib/context-menu", () => ({
  createContextMenu: vi.fn(),
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { scope: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("@/electron-main/lib/open-external", () => ({
  openExternal: vi.fn(),
}));
vi.mock("@/electron-main/lib/theme-utils", () => ({
  getBackgroundColor: () => "#000000",
}));
vi.mock("@/electron-main/lib/try-capture-error", () => ({
  tryCaptureError: (_label: string, fn: () => void) => {
    fn();
  },
}));
vi.mock("@/electron-main/lib/urls", () => ({
  unsafe_studioURL: (path: string) => `studio://${path}`,
}));

interface FakeView {
  setBackgroundColor: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
}

interface FakeWebContents {
  close: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  navigationHistory: {
    clear: ReturnType<typeof vi.fn>;
    goBack: ReturnType<typeof vi.fn>;
    goForward: ReturnType<typeof vi.fn>;
  };
  send: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
}

const createdViews: FakeView[] = [];

vi.mock("electron", () => ({
  WebContentsView: function FakeWebContentsView(this: FakeView) {
    const view: FakeView = {
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      webContents: {
        close: vi.fn(),
        focus: vi.fn(),
        loadURL: vi.fn(),
        navigationHistory: {
          clear: vi.fn(),
          goBack: vi.fn(),
          goForward: vi.fn(),
        },
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
    createdViews.push(view);
    return view;
  },
}));

const { createStudioOverlayController } = await import("./studio-overlay");

function makeBaseWindow() {
  const addChildView = vi.fn();
  const removeChildView = vi.fn();
  const baseWindow = {
    contentView: { addChildView, removeChildView },
    getContentBounds: () => ({ height: 800, width: 1200, x: 0, y: 0 }),
  } as unknown as BaseWindow;
  return { addChildView, baseWindow, removeChildView };
}

beforeEach(() => {
  createdViews.length = 0;
  vi.clearAllMocks();
});

describe("createStudioOverlayController", () => {
  it("show creates one overlay and resolves when resolve is called", async () => {
    const { addChildView, baseWindow } = makeBaseWindow();
    const onClosed = vi.fn();
    const controller = createStudioOverlayController({ baseWindow, onClosed });

    const promise = controller.show({ kind: "login" });
    expect(controller.isActive()).toBe(true);
    expect(controller.activeKind()).toBe("login");
    expect(createdViews).toHaveLength(1);
    expect(addChildView).toHaveBeenCalledTimes(1);

    controller.resolve();

    await expect(promise).resolves.toEqual({ completed: true });
    expect(controller.isActive()).toBe(false);
    expect(controller.activeKind()).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("boots the document once, then navigates via replace IPC", async () => {
    const { baseWindow, removeChildView } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const first = controller.show({ kind: "login" });
    const { webContents } = createdViews[0] ?? {};
    // First open boots the renderer document with a real load (no clear, no
    // IPC navigate: the load itself lands on the route).
    expect(webContents?.loadURL).toHaveBeenCalledTimes(1);
    expect(webContents?.loadURL).toHaveBeenLastCalledWith(
      "studio:///studio-overlay/login",
    );
    expect(webContents?.send).not.toHaveBeenCalled();
    expect(webContents?.navigationHistory.clear).not.toHaveBeenCalled();

    controller.dismiss();
    await expect(first).resolves.toEqual({ completed: false });
    // Dismiss unmounts the view but keeps it warm: removed from the window,
    // parked on idle over IPC, and never closed so reopening is instant.
    expect(removeChildView).toHaveBeenCalledTimes(1);
    expect(webContents?.close).not.toHaveBeenCalled();
    expect(webContents?.send).toHaveBeenLastCalledWith(
      "studio-overlay:navigate",
      "/studio-overlay-idle",
      1,
    );
    expect(controller.isActive()).toBe(false);

    // Parking and the next open are client-side replace navigation over IPC,
    // never a second document load, so the view stays warm. The open flattens
    // webContents history first so back/forward can't reach idle or a prior
    // open's pushed sub-routes.
    const second = controller.show({ kind: "settings" });
    expect(webContents?.loadURL).toHaveBeenCalledTimes(1);
    expect(webContents?.navigationHistory.clear).toHaveBeenCalledTimes(1);
    expect(webContents?.send.mock.calls).toEqual([
      ["studio-overlay:navigate", "/studio-overlay-idle", 1],
      ["studio-overlay:navigate", "/studio-overlay/settings", 2],
    ]);

    controller.dismiss();
    await expect(second).resolves.toEqual({ completed: false });
  });

  it("reuses the same warm view when reopened after dismiss", async () => {
    const { addChildView, baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const first = controller.show({ kind: "login" });
    controller.dismiss();
    await expect(first).resolves.toEqual({ completed: false });

    const second = controller.show({ kind: "settings" });

    // No second WebContentsView is constructed; the warm one is reused and
    // re-added to the window.
    expect(createdViews).toHaveLength(1);
    expect(addChildView).toHaveBeenCalledTimes(2);
    expect(controller.activeKind()).toBe("settings");

    controller.dismiss();
    await expect(second).resolves.toEqual({ completed: false });
  });

  it("teardown destroys the warm view", () => {
    const { baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    void controller.show({ kind: "login" });
    controller.teardown();

    expect(createdViews[0]?.webContents.close).toHaveBeenCalledTimes(1);
    expect(controller.isActive()).toBe(false);
  });

  it("replacing an active modal resolves the previous caller as replaced", async () => {
    const { baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const first = controller.show({ kind: "login" });
    const second = controller.show({
      kind: "login",
      props: { reason: "provider-required" },
    });

    await expect(first).resolves.toEqual({ completed: false });
    // The single warm view is reused (navigated) rather than recreated.
    expect(createdViews).toHaveLength(1);
    expect(controller.isActive()).toBe(true);

    controller.dismiss();
    await expect(second).resolves.toEqual({ completed: false });
  });

  it("re-showing the identical modal keeps it open and focuses it", async () => {
    const { addChildView, baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const first = controller.show({ kind: "settings" });
    const view = createdViews[0];
    expect(addChildView).toHaveBeenCalledTimes(1);
    view?.webContents.focus.mockClear();

    // Same kind + same props (e.g. pressing the settings hotkey again).
    const duplicate = controller.show({ kind: "settings" });

    await expect(duplicate).resolves.toEqual({ completed: false });
    // No new view, no re-add; the open modal stays put and is focused.
    expect(createdViews).toHaveLength(1);
    expect(addChildView).toHaveBeenCalledTimes(1);
    expect(view?.webContents.focus).toHaveBeenCalledTimes(1);
    expect(controller.isActive()).toBe(true);

    controller.dismiss();
    await expect(first).resolves.toEqual({ completed: false });
  });

  it("dismiss is a no-op for a non-dismissible kind, but fail/resolve still close it", async () => {
    const { baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const promise = controller.show({ kind: "welcome" });
    // Cmd+W / Escape / click-outside all route through dismiss(); it must not
    // close a kind the user has to finish.
    controller.dismiss();
    expect(controller.isActive()).toBe(true);
    expect(controller.activeKind()).toBe("welcome");

    // Completing the flow (resolve) still closes it.
    controller.resolve();
    await expect(promise).resolves.toEqual({ completed: true });
    expect(controller.isActive()).toBe(false);
  });

  it("show does not replace a non-dismissible active overlay", async () => {
    const { baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const welcome = controller.show({ kind: "welcome" });
    expect(controller.activeKind()).toBe("welcome");

    // Attempting to open settings while welcome is active must be a no-op.
    const settings = controller.show({ kind: "settings" });
    await expect(settings).resolves.toEqual({ completed: false });
    expect(controller.activeKind()).toBe("welcome");
    expect(controller.isActive()).toBe(true);

    controller.resolve();
    await expect(welcome).resolves.toEqual({ completed: true });
  });

  it("fail closes a non-dismissible kind", async () => {
    const { baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    const promise = controller.show({ kind: "welcome" });
    controller.fail();
    await expect(promise).resolves.toEqual({ completed: false });
    expect(controller.isActive()).toBe(false);
  });

  it("onActiveChange fires once on open and once on close, not on replace", () => {
    const { baseWindow } = makeBaseWindow();
    const onActiveChange = vi.fn();
    const controller = createStudioOverlayController({
      baseWindow,
      onActiveChange,
      onClosed: vi.fn(),
    });

    void controller.show({ kind: "login" });
    expect(onActiveChange.mock.calls).toEqual([[true]]);

    // Replacing while open stays "open": no extra event.
    void controller.show({ kind: "login" });
    expect(onActiveChange.mock.calls).toEqual([[true]]);

    controller.dismiss();
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("goBack/goForward drive the active overlay's own history", () => {
    const { baseWindow } = makeBaseWindow();
    const controller = createStudioOverlayController({
      baseWindow,
      onClosed: vi.fn(),
    });

    void controller.show({ kind: "login" });
    const { webContents } = createdViews[0] ?? {};
    const history = webContents?.navigationHistory;
    // Showing focuses the view; clear so we only count the nav-driven focuses.
    webContents?.focus.mockClear();

    controller.goBack();
    controller.goForward();

    expect(history?.goBack).toHaveBeenCalledTimes(1);
    expect(history?.goForward).toHaveBeenCalledTimes(1);
    // Each nav pulls focus back into the overlay so keyboard input lands there.
    expect(webContents?.focus).toHaveBeenCalledTimes(2);
  });
});
