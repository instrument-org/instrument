import { EventEmitter } from "node:events";
import Module, { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// What the extensions are told of the tabs, read off the library itself as
// patched (`patches/electron-chrome-extensions@4.10.0.patch`): it runs in main
// with Electron, so it is loaded here by Node with a stand-in for the few
// Electron objects these paths touch.

class FakeWindow extends EventEmitter {
  static count = 0;
  readonly id = ++FakeWindow.count;
  isDestroyed = () => false;
  isFocused = () => true;
  isMaximized = () => false;
  isMinimized = () => false;
  isFullScreen = () => false;
  isAlwaysOnTop = () => false;
  getSize = () => [800, 600];
  getPosition = () => [0, 0];
}

const contents = new Map<number, FakeContents>();

class FakeContents extends EventEmitter {
  static count = 0;
  readonly id = ++FakeContents.count;
  audioMuted = false;
  private destroyed = false;
  constructor(readonly session: object) {
    super();
    contents.set(this.id, this);
  }
  isDestroyed = () => this.destroyed;
  getType = () => "webview";
  getURL = () => `https://example.com/${this.id}`;
  getTitle = () => `Page ${this.id}`;
  isLoading = () => false;
  isCurrentlyAudible = () => false;
  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

// The library keeps one instance per session, so each test has its own.
const makeSession = () =>
  Object.assign(new EventEmitter(), {
    cookies: new EventEmitter(),
    extensions: Object.assign(new EventEmitter(), {
      getAllExtensions: () => [],
    }),
    getPreloads: () => [],
    isPersistent: () => true,
    protocol: { handle() {}, isProtocolHandled: () => false },
    registerPreloadScript() {},
    serviceWorkers: Object.assign(new EventEmitter(), {
      startWorkerForScope: () => Promise.resolve({ send() {} }),
    }),
  });

const electron = {
  app: Object.assign(new EventEmitter(), { isReady: () => true }),
  BaseWindow: { getAllWindows: () => [] },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  ipcMain: Object.assign(new EventEmitter(), { handle() {} }),
  session: {},
  webContents: { fromId: (id: number) => contents.get(id) },
};

type Library = {
  ElectronChromeExtensions: new (options: object) => {
    addTab(tab: FakeContents, window: FakeWindow): void;
    removeTab(tab: FakeContents): void;
    selectTab(tab: FakeContents): void;
    api: {
      tabs: {
        getCurrent(event: object): { id: number } | undefined;
        query(event: object, info: object): { id: number }[];
      };
      windows: { getLastFocused(event: object): { id: number } | null };
    };
    ctx: {
      router: { broadcastEvent(name: string, ...args: unknown[]): void };
    };
  };
};

/** The library, with `require("electron")` answered by the stand-in. */
function loadLibrary(): Library {
  // `_load` is Node's internal module loader, which no public type declares.
  const loader = Module as unknown as {
    _load(request: string, ...rest: unknown[]): unknown;
  };
  const load = loader._load;
  loader._load = (request, ...rest) =>
    request === "electron" ? electron : load(request, ...rest);
  try {
    // A module with no types of its own here, shaped as `Library` says.
    return createRequire(import.meta.url)(
      "electron-chrome-extensions",
    ) as Library;
  } finally {
    loader._load = load;
  }
}

function setUp() {
  const { ElectronChromeExtensions } = loadLibrary();
  const session = makeSession();
  const asked = { selectTab: 0 };
  const extensions = new ElectronChromeExtensions({
    selectTab: () => asked.selectTab++,
    session,
  });
  const sent: string[] = [];
  const broadcast = extensions.ctx.router.broadcastEvent.bind(
    extensions.ctx.router,
  );
  extensions.ctx.router.broadcastEvent = (name, ...args) => {
    sent.push(name);
    broadcast(name, ...args);
  };
  const activeTabs = () =>
    extensions.api.tabs.query({}, { active: true }).map(({ id }) => id);
  const newTab = () => new FakeContents(session);
  return { activeTabs, asked, extensions, newTab, sent };
}

describe("the tabs the extensions are told of", () => {
  it("activates only the tab the app selects, as Chrome does", () => {
    const { activeTabs, asked, extensions, newTab, sent } = setUp();
    const activations = () =>
      sent.filter((name) => name === "tabs.onActivated").length;
    const window = new FakeWindow();
    // Tabs agents open out of sight, and discarded tabs' guests coming back.
    const later = newTab();
    extensions.addTab(later, window);
    for (let i = 0; i < 19; i++) {
      extensions.addTab(newTab(), window);
    }
    expect(activeTabs()).toEqual([]);
    expect(activations()).toBe(0);
    expect(sent.filter((name) => name === "tabs.onCreated")).toHaveLength(20);

    const shown = newTab();
    extensions.addTab(shown, window);
    extensions.selectTab(shown);
    extensions.addTab(newTab(), window);
    expect(activeTabs()).toEqual([shown.id]);
    expect(activations()).toBe(1);

    // A tab registered in the background, shown later.
    extensions.selectTab(later);
    expect(activeTabs()).toEqual([later.id]);
    expect(activations()).toBe(2);
    expect(asked.selectTab).toBe(2);
  });

  it("leaves a window no active tab once its shown tab moves away", () => {
    const { extensions, newTab } = setUp();
    const window = new FakeWindow();
    const tab = newTab();
    extensions.addTab(tab, window);
    extensions.selectTab(tab);
    window.emit("focus");
    // A guest handed to another window leaves this one while it lives on.
    extensions.removeTab(tab);
    expect(extensions.api.tabs.getCurrent({})).toBeUndefined();
  });

  it("keeps a window whose tabs all closed as the last focused", () => {
    const { extensions, newTab } = setUp();
    const window = new FakeWindow();
    const tab = newTab();
    extensions.addTab(tab, window);
    window.emit("focus");
    tab.destroy();
    expect(extensions.api.windows.getLastFocused({})?.id).toBe(window.id);
  });
});
