import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { folderHref } from "@/shared/computer-href";

import { createKeptStateStore, rewriteFolderAddresses } from "./kept-state";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kept-state-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

const read = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

it("writes each key to its file on flush, and reads them back in a new store", () => {
  const store = createKeptStateStore(() => dir);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.set("view", "zoom.v1", 1.25);
  expect(fs.readdirSync(dir)).toEqual([]);

  store.flush();

  expect(fs.readdirSync(dir).toSorted()).toMatchInlineSnapshot(`
    [
      "layout.json",
      "view.json",
    ]
  `);
  expect(read("view.json")).toEqual({ "zoom.v1": 1.25 });
  expect(createKeptStateStore(() => dir).snapshot()).toEqual({
    groups: {},
    layout: { "app-tabs.v2": { tabs: [] } },
    view: { "zoom.v1": 1.25 },
  });
});

it("leaves a file it could not read as it is", () => {
  fs.writeFileSync(
    path.join(dir, "layout.json"),
    JSON.stringify({ "app-tabs.v2": { tabs: ["kept"] } }),
  );
  const readFileSync = fs.readFileSync;
  const held = vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
    if (args[0] === path.join(dir, "layout.json")) {
      throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
    }
    return readFileSync(...args);
  });
  const store = createKeptStateStore(() => dir);
  store.set("layout", "sidebar.v1", 240);
  store.set("view", "zoom.v1", 1.25);
  store.flush();
  held.mockRestore();

  expect(read("layout.json")).toEqual({ "app-tabs.v2": { tabs: ["kept"] } });
  expect(read("view.json")).toEqual({ "zoom.v1": 1.25 });
});

it("writes each file into the folder named for it, making the folder", () => {
  const left = path.join(dir, "left");
  const laidOut = path.join(dir, "laid-out");
  const dirOf = (file: string) => (file === "layout" ? left : laidOut);
  const store = createKeptStateStore(dirOf);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.set("view", "zoom.v1", 1.25);

  store.flush();

  expect(fs.readdirSync(left)).toEqual(["layout.json"]);
  expect(fs.readdirSync(laidOut)).toEqual(["view.json"]);
  expect(createKeptStateStore(dirOf).snapshot()).toMatchObject({
    layout: { "app-tabs.v2": { tabs: [] } },
    view: { "zoom.v1": 1.25 },
  });
});

it("rewrites only the files that changed", () => {
  const store = createKeptStateStore(() => dir);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.flush();
  store.set("view", "zoom.v1", 2);
  store.flush();
  fs.rmSync(path.join(dir, "layout.json"));

  store.set("view", "zoom.v1", 1);
  store.flush();

  expect(fs.existsSync(path.join(dir, "layout.json"))).toBe(false);
});

it("removes a key set to undefined", () => {
  const store = createKeptStateStore(() => dir);
  store.set("view", "zoom.v1", 2);
  store.set("view", "pane-share.v1", 0.5);
  store.set("view", "zoom.v1", undefined);
  store.flush();

  expect(read("view.json")).toEqual({ "pane-share.v1": 0.5 });
});

it.each([
  ["not JSON", "{ tabs"],
  ["JSON that is not an object", "[1, 2]"],
])("sets aside a file that is %s before writing a new one", (_, contents) => {
  vi.useFakeTimers({ now: 1000 });
  fs.writeFileSync(path.join(dir, "layout.json"), contents);
  fs.writeFileSync(
    path.join(dir, "view.json"),
    JSON.stringify({ "zoom.v1": 1.5 }),
  );
  const store = createKeptStateStore(() => dir);

  expect(store.snapshot()).toMatchObject({
    layout: {},
    view: { "zoom.v1": 1.5 },
  });
  store.set("layout", "sidebar.v1", 240);
  store.flush();
  vi.useRealTimers();

  expect(fs.readdirSync(dir).toSorted()).toEqual([
    "layout.json",
    "layout.json.corrupt-1000",
    "view.json",
  ]);
  expect(
    fs.readFileSync(path.join(dir, "layout.json.corrupt-1000"), "utf8"),
  ).toBe(contents);
  expect(read("layout.json")).toEqual({ "sidebar.v1": 240 });
});

it("writes nothing over a corrupt file it could not set aside", () => {
  fs.writeFileSync(path.join(dir, "layout.json"), "{ tabs");
  const renamed = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("not permitted"), { code: "EPERM" });
  });
  const store = createKeptStateStore(() => dir);
  store.set("layout", "sidebar.v1", 240);
  store.flush();
  renamed.mockRestore();

  expect(fs.readFileSync(path.join(dir, "layout.json"), "utf8")).toBe("{ tabs");
});

it("leaves no temporary file behind", () => {
  const store = createKeptStateStore(() => dir);
  store.set("view", "zoom.v1", 1);
  store.flush();

  expect(fs.readdirSync(dir)).toEqual(["view.json"]);
});

describe("the Files addresses a window is left on", () => {
  /** Where the person left off: a tab per Files address, and one on a chat. */
  function writeLayout() {
    fs.writeFileSync(
      path.join(dir, "layout.json"),
      JSON.stringify({
        "window-tabs.v9": {
          tabs: [
            {
              href: `/files?path=&root=${encodeURIComponent("/data/workspace/Chats/Quiet dishwashers")}`,
            },
            {
              href: `/files?file=${encodeURIComponent("/data/workspace/report.pdf")}&path=&root=~`,
            },
            { href: "/files?path=Documents%2F&root=~" },
            // As the router writes a search, each space a `+`.
            { href: folderHref("/data/workspace/Chats/Garden plans") },
            { href: "/chats/c1" },
          ],
        },
        "zoom.v1": 1,
      }),
    );
  }

  const moved = (hostPath: string) =>
    hostPath.replace("/data/workspace", "/Users/sam/Documents/Instrument");

  it("names each address's folder and file where a move took them", () => {
    writeLayout();

    const done = rewriteFolderAddresses(dir, moved);

    expect(createKeptStateStore(() => dir).snapshot().layout)
      .toMatchInlineSnapshot(`
        {
          "window-tabs.v9": {
            "tabs": [
              {
                "href": "/files?path=&root=%2FUsers%2Fsam%2FDocuments%2FInstrument%2FChats%2FQuiet%20dishwashers",
              },
              {
                "href": "/files?file=%2FUsers%2Fsam%2FDocuments%2FInstrument%2Freport.pdf&path=&root=~",
              },
              {
                "href": "/files?path=Documents%2F&root=~",
              },
              {
                "href": "/files?path=&root=%2FUsers%2Fsam%2FDocuments%2FInstrument%2FChats%2FGarden+plans",
              },
              {
                "href": "/chats/c1",
              },
            ],
          },
          "zoom.v1": 1,
        }
      `);
    expect(done).toEqual([
      `wrote 3 address(es) where they went in ${path.join(dir, "layout.json")}`,
    ]);
  });

  it("writes nothing on the run after, and nothing where there is no file", () => {
    expect(rewriteFolderAddresses(dir, moved)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "layout.json"))).toBe(false);
    writeLayout();
    rewriteFolderAddresses(dir, moved);
    const written = fs.readFileSync(path.join(dir, "layout.json"), "utf8");

    expect(rewriteFolderAddresses(dir, moved)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "layout.json"), "utf8")).toBe(
      written,
    );
  });
});

it("writes where a folder went in what each window keeps for itself too", () => {
  const windows = path.join(dir, "windows");
  fs.mkdirSync(windows);
  fs.writeFileSync(
    path.join(windows, "w1.json"),
    JSON.stringify({ "app-tabs.v2": { pathname: "/files?root=/old/a" } }),
  );

  const done = rewriteFolderAddresses(dir, (hostPath) =>
    hostPath.replace("/old", "/new"),
  );

  expect(done).toHaveLength(1);
  expect(read("windows/w1.json")).toEqual({
    "app-tabs.v2": { pathname: "/files?root=%2Fnew%2Fa" },
  });
});

it("writes nothing it was told to drop, for a file about to be removed", () => {
  vi.useFakeTimers();
  const store = createKeptStateStore(() => dir);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.discard();
  vi.runAllTimers();
  vi.useRealTimers();
  expect(fs.existsSync(path.join(dir, "layout.json"))).toBe(false);
});

describe("a tab group's lifetime", () => {
  const member = (tabs: string[]) => ({
    focused: 0,
    sides: [{ tabs: tabs.map((id) => ({ id, kind: "page" })) }],
  });

  /** A launch of this build, on the folder under test. */
  async function launch() {
    vi.resetModules();
    vi.doMock("@/electron-main/lib/get-workspace-folder", () => ({
      workspaceWindowDir: () => dir,
    }));
    vi.doMock("electron", () => ({
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { on: () => undefined },
    }));
    return import("./kept-state");
  }

  afterEach(() => {
    vi.doUnmock("@/electron-main/lib/get-workspace-folder");
    vi.doUnmock("electron");
  });

  beforeEach(() => {
    fs.mkdirSync(path.join(dir, "windows"));
    fs.writeFileSync(
      path.join(dir, "windows/open.json"),
      JSON.stringify({ "tab-group-list.v2": ["group:a", "group:empty"] }),
    );
    fs.writeFileSync(
      path.join(dir, "windows/closed.json"),
      JSON.stringify({ "tab-group-list.v2": ["group:b"] }),
    );
    fs.writeFileSync(
      path.join(dir, "groups.json"),
      JSON.stringify({
        "tab-groups.v3/-": member(["t0"]),
        "tab-groups.v3/group:a": member(["t1"]),
        "tab-groups.v3/group:b": member(["t2"]),
        "tab-groups.v3/group:empty": { ...member([]), pinned: true },
        "tab-groups.v3/group:gone": member(["t3"]),
        "tab-groups.v3/site:s": member(["t4"]),
      }),
    );
  });

  it("starts a launch with only the groups some window lists, and that have tabs", async () => {
    const { getKeptState } = await launch();
    expect(getKeptState("groups", "tab-groups.v3/group:gone")).toBeUndefined();
    expect(getKeptState("groups", "tab-groups.v3/group:empty")).toBeUndefined();
    for (const kept of ["-", "group:a", "group:b", "site:s"]) {
      expect(getKeptState("groups", `tab-groups.v3/${kept}`)).toBeDefined();
    }
  });

  it("ends with the window that last listed it, once that window is forgotten", async () => {
    const { forgetWindowKeptState, getKeptState } = await launch();
    forgetWindowKeptState("closed");
    expect(getKeptState("groups", "tab-groups.v3/group:b")).toBeUndefined();
    expect(getKeptState("groups", "tab-groups.v3/group:a")).toBeDefined();
  });

  it("stays while a window just opened on it lists it, before it loads", async () => {
    const { forgetWindowKeptState, getKeptState, setWindowKeptState } =
      await launch();
    setWindowKeptState("new", "tab-group-list.v2", ["group:b"]);
    forgetWindowKeptState("closed");
    expect(getKeptState("groups", "tab-groups.v3/group:b")).toBeDefined();
  });

  it("comes off a closed window's list once an open window lists it", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    vi.resetModules();
    vi.doMock("@/electron-main/lib/get-workspace-folder", () => ({
      workspaceWindowDir: () => dir,
    }));
    vi.doMock("electron", () => ({
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: {
        on: (channel: string, handler: (...args: unknown[]) => void) => {
          handlers.set(channel, handler);
        },
      },
    }));
    const { getWindowKeptState, serveKeptState } = await import("./kept-state");
    const { nameAppWindow } =
      await import("@/electron-main/windows/app-window-ids");
    nameAppWindow(1, "open");
    serveKeptState();
    handlers.get("kept-state:set")?.(
      { sender: { id: 1 } },
      "window",
      "tab-group-list.v2",
      ["group:a", "group:b"],
    );
    expect(getWindowKeptState("closed", "tab-group-list.v2")).toEqual([]);
    expect(getWindowKeptState("open", "tab-group-list.v2")).toEqual([
      "group:a",
      "group:b",
    ]);
  });
});
