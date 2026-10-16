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
    const stop = folders.watchKeyFolders(root, (missing) => {
      seen.push([...missing]);
    });
    fs.rmSync(path.join(root, "Drafts"), { recursive: true });
    await vi.waitFor(() => expect(seen).toContainEqual(["Drafts"]), {
      // The watch collects a burst before it checks, and a loaded machine
      // delivers the first event late; generous because the assertion is that
      // it happens at all, not how soon.
      timeout: 10_000,
    });
    stop();
  }, 15_000);

  it("stops answering once the watch is stopped", async () => {
    const { folders } = await load();
    fs.mkdirSync(path.join(root, "Drafts"));
    folders.recordKeyFolders(root, ["Drafts"]);

    const seen: string[][] = [];
    const stop = folders.watchKeyFolders(root, (missing) => {
      seen.push([...missing]);
    });
    stop();
    fs.rmSync(path.join(root, "Drafts"), { recursive: true });
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
    vi.stubEnv("MAIN_VITE_REPORTS_BASE_URL", "https://reports.example");
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
        "body": "Instrument put Chats in your Instrument folder, and it isn't there now. Nothing is lost, and it will make it again next time it saves something.",
        "title": "Chats is gone",
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
        "body": "Instrument put Chats, Drafts and Topics in your Instrument folder, and they aren't there now. Nothing is lost, and it will make them again next time it saves something.",
        "title": "Some folders are gone",
      }
    `);
  });

  it("stays dismissed when the same folders are noted again", async () => {
    const { notices } = await load();
    notices.noteMissingFolders(root, ["Chats"]);
    const shown = notices.listNotices();
    notices.dismissNotice(shown[0]?.id ?? "");

    notices.noteMissingFolders(root, ["Chats"]);

    expect(notices.listNotices()).toEqual([]);
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
