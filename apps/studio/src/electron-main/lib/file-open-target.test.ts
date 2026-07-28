import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");

// Matches SAVE_DEBOUNCE_MS in the module under test.
const SAVE_DEBOUNCE_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-01T00:00:00Z").getTime();
// Matches CACHE_VERSION in the cache store.
const CACHE_VERSION = 8;

interface ExecCall {
  args: string[];
  file: string;
  script: string;
}

interface SavedCache {
  candidates: Record<string, { resolvedAt: number }>;
  icons: Record<string, { resolvedAt: number }>;
  targets: Record<string, { resolvedAt: number }>;
  version: number;
}

const execCalls: ExecCall[] = [];
let concurrentExecs = 0;
let peakConcurrentExecs = 0;
let execImpl: (call: ExecCall) => Promise<string>;
let fileIconImpl: () => Promise<{ name: string }>;

vi.mock("node:child_process", () => {
  const execFile = (() => {
    throw new Error("only the promisified form is used");
  }) as unknown as Record<symbol, unknown>;
  // `promisify` defers to this when present, and it is what resolves to the
  // `{ stdout }` shape the module reads.
  execFile[PROMISIFY_CUSTOM] = async (file: string, args: string[]) => {
    const call = { args, file, script: args[3] ?? "" };
    execCalls.push(call);
    concurrentExecs++;
    peakConcurrentExecs = Math.max(peakConcurrentExecs, concurrentExecs);
    try {
      return { stderr: "", stdout: await execImpl(call) };
    } finally {
      concurrentExecs--;
    }
  };
  return { execFile };
});

vi.mock("./app-protocol", () => ({
  storeFileOpenIcon: (base64: string) =>
    Promise.resolve(base64 ? `icon://${base64}` : null),
  storeFileOpenNativeImage: (image: { name: string }) =>
    Promise.resolve(`native://${image.name}`),
}));

let userDataDir: string;

vi.mock("electron", () => ({
  app: {
    getFileIcon: () => fileIconImpl(),
    getPath: (name: string) =>
      name === "userData" ? userDataDir : os.tmpdir(),
  },
}));

// The module short-circuits every non-macOS platform, so the suite has to look
// like macOS regardless of where it runs.
const originalPlatform = process.platform;

function cachePath() {
  return path.join(userDataDir, "file-open-targets.json");
}

// Each extension resolves to its own app plus one shared app, so tests can tell
// per-file-type work apart from per-app work.
function candidatesFor(filePath: string) {
  const ext = path.extname(filePath).replace(".", "");
  return JSON.stringify({
    apps: [
      {
        appName: `Editor ${ext}`,
        appPath: `/Applications/Editor-${ext}.app`,
        bundleId: `com.example.editor.${ext}`,
        isDefault: true,
      },
      {
        appName: "Shared Viewer",
        appPath: "/Applications/Shared.app",
        bundleId: "com.example.shared",
        isDefault: false,
      },
      {
        appName: "Instruments",
        appPath:
          "/Applications/Xcode.app/Contents/Applications/Instruments.app",
        bundleId: "com.apple.dt.Instruments",
        isDefault: false,
      },
      {
        appName: "Numbers",
        appPath: "/Applications/Numbers.app",
        bundleId: "com.apple.iWork.Numbers",
        isDefault: false,
      },
    ],
  });
}

function classify(call: ExecCall) {
  if (call.script.includes("URLsForApplicationsToOpenURL")) {
    return "candidates" as const;
  }
  if (call.script.includes("out.icons")) {
    return "icons" as const;
  }
  return "target" as const;
}

function defaultExecImpl(call: ExecCall) {
  switch (classify(call)) {
    case "candidates": {
      return Promise.resolve(candidatesFor(call.args[4] ?? ""));
    }
    case "icons": {
      return Promise.resolve(iconsFor(call));
    }
    case "target": {
      return Promise.resolve(
        JSON.stringify({ appName: "Editor.app", iconBase64: "png-target" }),
      );
    }
  }
}

function execsOfKind(kind: ReturnType<typeof classify>) {
  return execCalls.filter((call) => classify(call) === kind);
}

async function flushSave() {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  await settle();
}

function iconsFor(call: ExecCall) {
  return JSON.stringify({
    icons: call.args.slice(5).map((appPath) => ({
      appPath,
      iconBase64: `png-for-${path.basename(appPath)}`,
    })),
  });
}

async function importModule() {
  vi.resetModules();
  return import("./file-open-target");
}

// JSON.parse yields `any`, and the point of these tests is to assert against
// the on-disk shape rather than to re-derive it from the store's types.
async function readCache() {
  return JSON.parse(await fs.readFile(cachePath(), "utf8")) as SavedCache;
}

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value });
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Only the clock the module reads is faked. `setImmediate` stays real so tests
// can still yield a genuine event-loop turn, which is what the debounced save's
// `fs.writeFile` and the background refreshes need to actually land.
function useModuleClock() {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["Date", "clearTimeout", "setTimeout"],
  });
}

async function writeCache(payload: unknown) {
  await fs.writeFile(cachePath(), JSON.stringify(payload), "utf8");
}

beforeEach(async () => {
  execCalls.length = 0;
  concurrentExecs = 0;
  peakConcurrentExecs = 0;
  setPlatform("darwin");
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-open-target-"));
  execImpl = defaultExecImpl;
  fileIconImpl = () => Promise.reject(new Error("no file icon"));
});

afterEach(async () => {
  setPlatform(originalPlatform);
  await fs.rm(userDataDir, { force: true, recursive: true });
});

describe("getFileOpenCandidates", () => {
  it("drops excluded apps and pairs the rest with rendered icons", async () => {
    const { getFileOpenCandidates } = await importModule();

    expect(await getFileOpenCandidates("/tasks/a/notes.md"))
      .toMatchInlineSnapshot(`
        [
          {
            "appName": "Editor md",
            "appPath": "/Applications/Editor-md.app",
            "iconUrl": "icon://png-for-Editor-md.app",
            "isDefault": true,
          },
          {
            "appName": "Shared Viewer",
            "appPath": "/Applications/Shared.app",
            "iconUrl": "icon://png-for-Shared.app",
            "isDefault": false,
          },
        ]
      `);
  });

  it("keeps a restricted app for the types it does open", async () => {
    const { getFileOpenCandidates } = await importModule();

    const candidates = await getFileOpenCandidates("/tasks/a/rows.csv");

    expect(candidates.map(({ appName }) => appName)).toMatchInlineSnapshot(`
      [
        "Editor csv",
        "Shared Viewer",
        "Numbers",
      ]
    `);
  });

  it("never filters out the app the system opens the file with", async () => {
    const { getFileOpenCandidates } = await importModule();
    execImpl = (call) =>
      Promise.resolve(
        classify(call) === "icons"
          ? iconsFor(call)
          : JSON.stringify({
              apps: [
                {
                  appName: "Numbers",
                  appPath: "/Applications/Numbers.app",
                  bundleId: "com.apple.iWork.Numbers",
                  isDefault: true,
                },
                {
                  appName: "Shared Viewer",
                  appPath: "/Applications/Shared.app",
                  bundleId: "com.example.shared",
                  isDefault: false,
                },
              ],
            }),
      );

    // Numbers is restricted away from .md, but it is this file's default, so
    // dropping it would leave the menu disagreeing with the button beside it.
    const candidates = await getFileOpenCandidates("/tasks/a/notes.md");

    expect(candidates.map(({ appName }) => appName)).toMatchInlineSnapshot(`
      [
        "Numbers",
        "Shared Viewer",
      ]
    `);
  });

  it("caps the list so one promiscuous file type can't fill the menu", async () => {
    const { getFileOpenCandidates } = await importModule();
    execImpl = (call) =>
      Promise.resolve(
        classify(call) === "icons"
          ? iconsFor(call)
          : JSON.stringify({
              apps: Array.from({ length: 40 }, (_unused, index) => ({
                appName: `App ${index}`,
                appPath: `/Applications/App-${index}.app`,
                bundleId: `com.example.app${index}`,
                isDefault: index === 0,
              })),
            }),
      );

    expect(await getFileOpenCandidates("/tasks/a/notes.md")).toHaveLength(16);
  });

  it("rejects when the lookup fails instead of reporting no apps", async () => {
    const { getFileOpenCandidates } = await importModule();
    execImpl = () => Promise.reject(new Error("osascript timed out"));

    await expect(
      getFileOpenCandidates("/tasks/a/notes.md"),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: osascript timed out]`,
    );
  });

  it("retries a failed lookup on the next request", async () => {
    const { getFileOpenCandidates } = await importModule();
    execImpl = () => Promise.reject(new Error("osascript timed out"));
    await expect(getFileOpenCandidates("/tasks/a/notes.md")).rejects.toThrow();

    const failures = execCalls.length;
    execImpl = (call) =>
      Promise.resolve(
        classify(call) === "icons"
          ? iconsFor(call)
          : candidatesFor(call.args[4] ?? ""),
      );

    expect(await getFileOpenCandidates("/tasks/a/notes.md")).toHaveLength(2);
    expect(execCalls.length).toBeGreaterThan(failures);
  });

  it("renders each app's icon once across file types that share it", async () => {
    const { getFileOpenCandidates } = await importModule();

    await getFileOpenCandidates("/tasks/a/notes.md");
    await getFileOpenCandidates("/tasks/a/data.json");

    const rendered = execCalls
      .filter((call) => classify(call) === "icons")
      .flatMap((call) => call.args.slice(5));
    expect(rendered).toMatchInlineSnapshot(`
      [
        "/Applications/Editor-md.app",
        "/Applications/Shared.app",
        "/Applications/Editor-json.app",
      ]
    `);
  });

  it("reuses one lookup for every file of the same type", async () => {
    const { getFileOpenCandidates } = await importModule();

    await Promise.all([
      getFileOpenCandidates("/tasks/a/one.md"),
      getFileOpenCandidates("/tasks/a/two.md"),
      getFileOpenCandidates("/tasks/b/three.md"),
    ]);

    expect(
      execCalls.filter((call) => classify(call) === "candidates"),
    ).toHaveLength(1);
  });

  it("keeps the whole list when only icon rendering fails", async () => {
    const { getFileOpenCandidates } = await importModule();
    execImpl = (call) =>
      classify(call) === "icons"
        ? Promise.reject(new Error("icon render failed"))
        : Promise.resolve(candidatesFor(call.args[4] ?? ""));

    const candidates = await getFileOpenCandidates("/tasks/a/notes.md");

    expect(candidates.map(({ appName, iconUrl }) => ({ appName, iconUrl })))
      .toMatchInlineSnapshot(`
      [
        {
          "appName": "Editor md",
          "iconUrl": null,
        },
        {
          "appName": "Shared Viewer",
          "iconUrl": null,
        },
      ]
    `);
  });

  it("caps how many lookups run at once", async () => {
    const { getFileOpenCandidates } = await importModule();
    const release: (() => void)[] = [];
    execImpl = (call) =>
      new Promise((resolve) => {
        release.push(() => {
          resolve(
            classify(call) === "icons"
              ? iconsFor(call)
              : candidatesFor(call.args[4] ?? ""),
          );
        });
      });

    const extensions = ["md", "json", "csv", "txt", "png", "pdf"];
    const pending = Promise.all(
      extensions.map((ext) => getFileOpenCandidates(`/tasks/a/file.${ext}`)),
    );
    // Drain in waves: each release lets a queued lookup take the freed slot,
    // and finishing a candidate list queues that type's icon lookup in turn.
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      for (const resolve of release.splice(0)) {
        resolve();
      }
    }
    await pending;

    expect(peakConcurrentExecs).toBe(2);
  });

  it("returns nothing on platforms without a portable enumeration", async () => {
    setPlatform("win32");
    const { getFileOpenCandidates } = await importModule();

    expect(await getFileOpenCandidates("/tasks/a/notes.md")).toEqual([]);
    expect(execCalls).toHaveLength(0);
  });
});

describe("getFileOpenTarget", () => {
  it("resolves the default app and its icon", async () => {
    const { getFileOpenTarget } = await importModule();

    expect(await getFileOpenTarget("/tasks/a/notes.md")).toMatchInlineSnapshot(`
      {
        "appName": "Editor",
        "iconUrl": "icon://png-target",
      }
    `);
  });

  it("reuses one lookup for every file of the same type", async () => {
    const { getFileOpenTarget } = await importModule();

    await getFileOpenTarget("/tasks/a/one.md");
    await getFileOpenTarget("/tasks/b/two.md");

    expect(execsOfKind("target")).toHaveLength(1);
  });

  it("resolves extension-less files per path, for the session only", async () => {
    const { getFileOpenTarget } = await importModule();

    await getFileOpenTarget("/tasks/a/Makefile");
    await getFileOpenTarget("/tasks/a/Makefile");
    await getFileOpenTarget("/tasks/a/LICENSE");

    expect(execsOfKind("target")).toHaveLength(2);
    // Nothing keyed by a full path may reach disk: it can never be reused.
    await expect(readCache()).rejects.toThrow();
  });

  it("falls back to the file-type icon when no app is associated", async () => {
    const { getFileOpenTarget } = await importModule();
    execImpl = () =>
      Promise.resolve(JSON.stringify({ appName: "", iconBase64: "" }));
    fileIconImpl = () => Promise.resolve({ name: "file-type" });

    expect(await getFileOpenTarget("/tasks/a/notes.xyz"))
      .toMatchInlineSnapshot(`
        {
          "appName": null,
          "iconUrl": "native://file-type",
        }
      `);
  });

  it("returns a fallback target rather than rejecting when the lookup fails", async () => {
    const { getFileOpenTarget } = await importModule();
    execImpl = () => Promise.reject(new Error("osascript timed out"));
    fileIconImpl = () => Promise.resolve({ name: "file-type" });

    expect(await getFileOpenTarget("/tasks/a/notes.md")).toMatchInlineSnapshot(`
        {
          "appName": null,
          "iconUrl": "native://file-type",
        }
      `);
  });

  it("retries a failed target lookup on the next request", async () => {
    const { getFileOpenTarget } = await importModule();
    execImpl = () => Promise.reject(new Error("osascript timed out"));
    await getFileOpenTarget("/tasks/a/notes.md");

    execImpl = defaultExecImpl;

    expect(await getFileOpenTarget("/tasks/a/notes.md")).toEqual({
      appName: "Editor",
      iconUrl: "icon://png-target",
    });
  });
});

describe("persisted cache", () => {
  beforeEach(() => {
    useModuleClock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses persisted targets and candidates on the next launch", async () => {
    const first = await importModule();
    await first.getFileOpenTarget("/tasks/a/notes.md");
    await first.getFileOpenCandidates("/tasks/a/notes.md");
    await flushSave();

    execCalls.length = 0;
    const second = await importModule();

    expect(await second.getFileOpenTarget("/tasks/b/other.md")).toEqual({
      appName: "Editor",
      iconUrl: "icon://png-target",
    });
    expect(
      await second.getFileOpenCandidates("/tasks/b/other.md"),
    ).toHaveLength(2);
    expect(execCalls).toHaveLength(0);
  });

  it("ignores a cache file written by a different version", async () => {
    await writeCache({
      targets: {
        ".md": { resolvedAt: NOW, value: { appName: "Stale", iconUrl: null } },
      },
      version: CACHE_VERSION - 1,
    });
    const { getFileOpenTarget } = await importModule();

    const target = await getFileOpenTarget("/tasks/a/notes.md");

    expect(target.appName).toBe("Editor");
  });

  it("ignores a malformed cache file", async () => {
    await fs.writeFile(cachePath(), "{ not json", "utf8");
    const { getFileOpenTarget } = await importModule();

    const target = await getFileOpenTarget("/tasks/a/notes.md");

    expect(target.appName).toBe("Editor");
  });

  it("serves a stale target while refreshing it in the background", async () => {
    const first = await importModule();
    await first.getFileOpenTarget("/tasks/a/notes.md");
    await flushSave();

    vi.setSystemTime(NOW + 8 * DAY_MS);
    execCalls.length = 0;
    const second = await importModule();
    execImpl = () =>
      Promise.resolve(
        JSON.stringify({ appName: "Newer.app", iconBase64: "png-newer" }),
      );

    // The stale value comes back immediately, without waiting on the refresh.
    const stale = await second.getFileOpenTarget("/tasks/a/notes.md");
    expect(stale.appName).toBe("Editor");

    await settle();
    const refreshed = await second.getFileOpenTarget("/tasks/a/notes.md");

    expect(execsOfKind("target")).toHaveLength(1);
    expect(refreshed.appName).toBe("Newer");
  });

  it("bounds how many targets it persists, keeping the newest", async () => {
    const targets: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) {
      targets[`.ext${i}`] = {
        // Older entries first, so trimming has a clear newest-wins ordering.
        resolvedAt: NOW - (300 - i) * 1000,
        value: { appName: `App ${i}`, iconUrl: null },
      };
    }
    await writeCache({ targets, version: CACHE_VERSION });

    const { getFileOpenTarget } = await importModule();
    await getFileOpenTarget("/tasks/a/notes.md");
    await flushSave();

    const saved = await readCache();
    expect(Object.keys(saved.targets)).toHaveLength(256);
    expect(saved.targets[".md"]).toBeDefined();
    expect(saved.targets[".ext299"]).toBeDefined();
    expect(saved.targets[".ext0"]).toBeUndefined();
  });

  it("persists icons keyed by app path, not by file type", async () => {
    const { getFileOpenCandidates } = await importModule();
    await getFileOpenCandidates("/tasks/a/notes.md");
    await flushSave();

    const saved = await readCache();
    expect(Object.keys(saved.icons)).toMatchInlineSnapshot(`
      [
        "/Applications/Editor-md.app",
        "/Applications/Shared.app",
      ]
    `);
  });
});

describe("icon resolution", () => {
  beforeEach(() => {
    useModuleClock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes stale icons in the background without blocking the list", async () => {
    const first = await importModule();
    await first.getFileOpenCandidates("/tasks/a/notes.md");
    await flushSave();

    vi.setSystemTime(NOW + 8 * DAY_MS);
    execCalls.length = 0;
    const second = await importModule();

    const candidates = await second.getFileOpenCandidates("/tasks/a/notes.md");

    // Served from the persisted entry, so no icon exec gated the response.
    expect(candidates[0]?.iconUrl).toBe("icon://png-for-Editor-md.app");
    await settle();
    expect(execsOfKind("icons")).toHaveLength(1);
  });

  it("refreshes a stale app icon once no matter how many types offer it", async () => {
    const first = await importModule();
    await first.getFileOpenCandidates("/tasks/a/notes.md");
    await first.getFileOpenCandidates("/tasks/a/data.json");
    await flushSave();

    vi.setSystemTime(NOW + 8 * DAY_MS);
    execCalls.length = 0;
    const second = await importModule();

    // Both types offer Shared.app, whose icon is now stale. One refresh of it
    // should be in flight, not one per requesting file type.
    await Promise.all([
      second.getFileOpenCandidates("/tasks/a/notes.md"),
      second.getFileOpenCandidates("/tasks/a/data.json"),
    ]);
    await settle();

    const refreshed = execsOfKind("icons").flatMap((call) =>
      call.args.slice(5),
    );
    expect(refreshed.filter((appPath) => appPath.includes("Shared"))).toEqual([
      "/Applications/Shared.app",
    ]);
  });
});

describe("warmCommonFileOpenTargets", () => {
  it("does nothing off macOS", async () => {
    setPlatform("linux");
    const { warmCommonFileOpenTargets } = await importModule();

    await warmCommonFileOpenTargets();

    expect(execCalls).toHaveLength(0);
  });

  it("warms only the file types missing from the cache", async () => {
    useModuleClock();
    try {
      const first = await importModule();
      await first.warmCommonFileOpenTargets();
      await flushSave();
      const warmed = execsOfKind("candidates").length;
      expect(warmed).toBeGreaterThan(0);

      execCalls.length = 0;
      const second = await importModule();
      await second.warmCommonFileOpenTargets();

      expect(execCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws when a lookup fails", async () => {
    execImpl = () => Promise.reject(new Error("osascript timed out"));
    const { warmCommonFileOpenTargets } = await importModule();

    await expect(warmCommonFileOpenTargets()).resolves.toBeUndefined();
  });
});

describe("linux", () => {
  let dataDir: string;

  beforeEach(async () => {
    setPlatform("linux");
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-open-xdg-"));
    await fs.mkdir(path.join(dataDir, "applications"), { recursive: true });
    vi.stubEnv("XDG_DATA_DIRS", dataDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dataDir, { force: true, recursive: true });
  });

  it("resolves the default app from the desktop entry", async () => {
    await fs.writeFile(
      path.join(dataDir, "applications", "org.example.Viewer.desktop"),
      "[Desktop Entry]\nName=Example Viewer\nExec=viewer %f\n",
      "utf8",
    );
    execImpl = (call) =>
      Promise.resolve(
        call.args[1] === "filetype"
          ? "text/markdown"
          : "org.example.Viewer.desktop",
      );
    const { getFileOpenTarget } = await importModule();

    expect(await getFileOpenTarget("/tasks/a/notes.md")).toMatchInlineSnapshot(`
        {
          "appName": "Example Viewer",
          "iconUrl": null,
        }
      `);
  });

  it("falls back when the desktop entry is missing", async () => {
    execImpl = (call) =>
      Promise.resolve(
        call.args[1] === "filetype" ? "text/markdown" : "ghost.desktop",
      );
    const { getFileOpenTarget } = await importModule();

    const target = await getFileOpenTarget("/tasks/a/notes.md");

    expect(target.appName).toBeNull();
  });
});

describe("win32", () => {
  beforeEach(() => {
    setPlatform("win32");
  });

  it("resolves the default app and its executable icon", async () => {
    execImpl = () =>
      Promise.resolve(
        JSON.stringify({ appName: "Example Editor", exePath: "C:\\ex.exe" }),
      );
    fileIconImpl = () => Promise.resolve({ name: "exe-icon" });
    const { getFileOpenTarget } = await importModule();

    expect(await getFileOpenTarget("/tasks/a/notes.md")).toMatchInlineSnapshot(`
        {
          "appName": "Example Editor",
          "iconUrl": "native://exe-icon",
        }
      `);
  });

  it("refuses to interpolate an extension that isn't a simple one", async () => {
    fileIconImpl = () => Promise.resolve({ name: "file-type" });
    const { getFileOpenTarget } = await importModule();

    const target = await getFileOpenTarget("/tasks/a/notes.'; rm -rf /;'");

    expect(target.appName).toBeNull();
    expect(execCalls).toHaveLength(0);
  });
});
