import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { stored, userData } = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  userData: { dir: "" },
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData.dir,
    getVersion: () => "2.0.0",
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  session: { defaultSession: undefined },
  shell: { openExternal: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({ get: () => undefined }),
}));
vi.mock("@/electron-main/stores/machine/state", () => ({
  getMachineState: () => ({
    delete: (key: string) => stored.delete(key),
    get: (key: string) => stored.get(key),
    set: (key: string, value: unknown) => stored.set(key, value),
  }),
}));
vi.mock("@/electron-main/platform-api/headers", () => ({
  getPlatformApiHeaders: () => ({ "x-client-version": "2.0.0" }),
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

/** A watch that fires when the test says so, in place of the system's. */
function fakeWatch() {
  let heard: (() => void) | undefined;
  let closed = false;
  return {
    fire: () => {
      if (!closed) {
        heard?.();
      }
    },
    watch: ((_root: unknown, _options: unknown, listener: () => void) => {
      heard = listener;
      return {
        close: () => {
          closed = true;
        },
        on: () => undefined,
      };
    }) as unknown as typeof fs.watch,
  };
}

/** A fresh copy of the modules, since the store is held in one. */
async function load() {
  vi.resetModules();
  return {
    folders: await import("./missing-key-folders"),
    notices: await import("./notices"),
  };
}

describe("missing key folders", () => {
  let root = "";

  beforeEach(() => {
    stored.clear();
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "folders-store-"));
    root = fs.mkdtempSync(path.join(os.tmpdir(), "folders-root-"));
    return () => {
      fs.rmSync(userData.dir, { force: true, recursive: true });
      fs.rmSync(root, { force: true, recursive: true });
    };
  });

  it("looks for a folder it made, and not for one that was never there", async () => {
    const { folders } = await load();
    fs.mkdirSync(path.join(root, "Chats"));
    folders.recordKeyFolders(root, ["Chats"]);

    expect(await folders.missingKeyFolders(root)).toEqual([]);

    fs.rmSync(path.join(root, "Chats"), { recursive: true });

    expect(await folders.missingKeyFolders(root)).toEqual(["Chats"]);
  });

  it("says nothing about a workspace it has made no folder in", async () => {
    const { folders } = await load();
    expect(await folders.missingKeyFolders(root)).toEqual([]);
  });

  it("ignores a name that is not one of the six", async () => {
    const { folders } = await load();
    folders.recordKeyFolders(root, ["Chats", "Receipts"]);

    expect(await folders.missingKeyFolders(root)).toEqual(["Chats"]);
  });

  it("lists them in reading order however they were recorded", async () => {
    const { folders } = await load();
    folders.recordKeyFolders(root, ["Skills", "Chats", "Topics"]);

    expect(await folders.missingKeyFolders(root)).toEqual([
      "Chats",
      "Topics",
      "Skills",
    ]);
  });

  it("counts a name the person replaced with a file as missing", async () => {
    const { folders } = await load();
    folders.recordKeyFolders(root, ["Memory"]);
    fs.writeFileSync(path.join(root, "Memory"), "not a folder");

    expect(await folders.missingKeyFolders(root)).toEqual(["Memory"]);
  });

  it("keeps what it recorded when a second launch records one more", async () => {
    const { folders } = await load();
    folders.recordKeyFolders(root, ["Chats"]);
    folders.recordKeyFolders(root, ["Drafts"]);

    expect(await folders.missingKeyFolders(root)).toEqual(["Chats", "Drafts"]);
  });

  it("records one workspace's folders without touching another's", async () => {
    const { folders } = await load();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "folders-other-"));
    folders.recordKeyFolders(root, ["Chats"]);
    folders.recordKeyFolders(other, ["Skills"]);

    expect(await folders.missingKeyFolders(root)).toEqual(["Chats"]);
    expect(await folders.missingKeyFolders(other)).toEqual(["Skills"]);
    fs.rmSync(other, { force: true, recursive: true });
  });

  it("notices one going while the app is open", async () => {
    const { folders } = await load();
    fs.mkdirSync(path.join(root, "Drafts"));
    folders.recordKeyFolders(root, ["Drafts"]);

    const seen: string[][] = [];
    const watch = fakeWatch();
    const stop = folders.watchKeyFolders(
      root,
      (missing) => {
        seen.push([...missing]);
      },
      { watch: watch.watch },
    );
    fs.rmSync(path.join(root, "Drafts"), { recursive: true });
    // Whether the system delivers the event is the system's business, and the
    // plan has that driven in a file manager; what is here is what happens
    // when one arrives.
    watch.fire();
    await vi.waitFor(() => expect(seen).toContainEqual(["Drafts"]));
    stop();
  });

  it("expects a folder the app made after the launch, without one", async () => {
    const { folders } = await load();
    // A fresh workspace: nothing was recorded at the launch, because nothing
    // was there yet.
    const seen: string[][] = [];
    const watch = fakeWatch();
    const stop = folders.watchKeyFolders(
      root,
      (missing) => {
        seen.push([...missing]);
      },
      { watch: watch.watch },
    );

    // The app makes it, which the watch hears.
    fs.mkdirSync(path.join(root, "Chats"));
    watch.fire();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual([]);

    // And the person deletes it in the same session.
    fs.rmSync(path.join(root, "Chats"), { recursive: true });
    watch.fire();
    await vi.waitFor(() => expect(seen).toContainEqual(["Chats"]));
    stop();
  });

  it("checks once for a burst of events, which one gesture sends", async () => {
    const { folders } = await load();
    fs.mkdirSync(path.join(root, "Drafts"));
    folders.recordKeyFolders(root, ["Drafts"]);

    const seen: string[][] = [];
    const watch = fakeWatch();
    const stop = folders.watchKeyFolders(
      root,
      (missing) => {
        seen.push([...missing]);
      },
      { watch: watch.watch },
    );
    fs.rmSync(path.join(root, "Drafts"), { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      watch.fire();
    }
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen).toEqual([["Drafts"]]);
    stop();
  });

  it("carries on when the system refuses to watch", async () => {
    const { folders } = await load();
    folders.recordKeyFolders(root, ["Drafts"]);

    const stop = folders.watchKeyFolders(root, () => undefined, {
      watch: () => {
        throw new Error("EMFILE");
      },
    });

    expect(stop).not.toThrow();
  });

  it("stops answering once the watch is stopped", async () => {
    const { folders } = await load();
    fs.mkdirSync(path.join(root, "Drafts"));
    folders.recordKeyFolders(root, ["Drafts"]);

    const seen: string[][] = [];
    const watch = fakeWatch();
    const stop = folders.watchKeyFolders(
      root,
      (missing) => {
        seen.push([...missing]);
      },
      { watch: watch.watch },
    );
    stop();
    fs.rmSync(path.join(root, "Drafts"), { recursive: true });
    watch.fire();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(seen).toEqual([]);
  });
});

describe("the notice for a folder that is gone", () => {
  let root = "";

  beforeEach(() => {
    stored.clear();
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "folders-store-"));
    root = fs.mkdtempSync(path.join(os.tmpdir(), "folders-root-"));
    vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://api.example");
    return () => {
      vi.unstubAllEnvs();
      fs.rmSync(userData.dir, { force: true, recursive: true });
      fs.rmSync(root, { force: true, recursive: true });
    };
  });

  it("says which one, and that nothing is lost", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats"]);

    const shown = notices.listNotices();
    expect(shown).toHaveLength(1);
    expect({ body: shown[0]?.body, title: shown[0]?.title })
      .toMatchInlineSnapshot(`
        {
          "body": "Your Chats folder isn't in your Instrument folder any more. Nothing is lost, and Instrument makes it again the next time it saves a chat.",
          "title": "Your Chats folder is gone",
        }
      `);
  });

  it("lists several in one notice", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats", "Drafts", "Topics"]);

    const shown = notices.listNotices();
    expect({ body: shown[0]?.body, title: shown[0]?.title })
      .toMatchInlineSnapshot(`
        {
          "body": "Your Chats, Drafts and Topics folders aren't in your Instrument folder any more. Nothing is lost, and Instrument makes them again the next time it saves a chat.",
          "title": "Some of your folders are gone",
        }
      `);
  });

  it("stays dismissed while the same folders are still gone", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats"]);
    const shown = notices.listNotices();
    notices.dismissNotice(shown[0]?.id ?? "");

    // The same record written again is the same notice, so a watch that fires
    // on every save does not bring back one the person dismissed.
    notices.noteMissingFolders(root, ["Chats"]);

    expect(notices.listNotices()).toEqual([]);
  });

  it("says so again when the folder goes a second time", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats"]);
    notices.dismissNotice(notices.listNotices()[0]?.id ?? "");
    // Back, then gone again: a different moment, so a notice of its own
    // rather than the one that was dismissed.
    notices.noteMissingFolders(root, []);
    await new Promise((resolve) => setTimeout(resolve, 2));
    notices.noteMissingFolders(root, ["Chats"]);

    expect(notices.listNotices()).toHaveLength(1);
  });

  it("is a new notice when another folder goes", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats"]);
    notices.dismissNotice(notices.listNotices()[0]?.id ?? "");

    notices.noteMissingFolders(root, ["Chats", "Drafts"]);

    expect(notices.listNotices()).toHaveLength(1);
  });

  it("goes once the folder is back", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats"]);
    notices.noteMissingFolders(root, []);

    expect(notices.listNotices()).toEqual([]);
  });
});
