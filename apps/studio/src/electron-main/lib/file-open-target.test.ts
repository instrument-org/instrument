import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");

interface ExecCall {
  args: string[];
  script: string;
}

const execCalls: ExecCall[] = [];
let concurrentExecs = 0;
let peakConcurrentExecs = 0;
let execImpl: (call: ExecCall) => Promise<string>;

vi.mock("node:child_process", () => {
  const execFile = (() => {
    throw new Error("only the promisified form is used");
  }) as unknown as Record<symbol, unknown>;
  // `promisify` defers to this when present, and it is what resolves to the
  // `{ stdout }` shape the module reads.
  execFile[PROMISIFY_CUSTOM] = async (_file: string, args: string[]) => {
    const call = { args, script: args[3] ?? "" };
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
  storeFileOpenNativeImage: () => Promise.resolve(null),
}));

let userDataDir: string;

vi.mock("electron", () => ({
  app: {
    getFileIcon: () => Promise.reject(new Error("no file icon")),
    getPath: (name: string) =>
      name === "userData" ? userDataDir : os.tmpdir(),
  },
}));

// The module short-circuits every non-macOS platform, so the suite has to look
// like macOS regardless of where it runs.
const originalPlatform = process.platform;

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

beforeEach(async () => {
  execCalls.length = 0;
  concurrentExecs = 0;
  peakConcurrentExecs = 0;
  Object.defineProperty(process, "platform", { value: "darwin" });
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-open-target-"));
  execImpl = (call) => {
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
  };
});

afterEach(async () => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
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
          },
          {
            "appName": "Shared Viewer",
            "appPath": "/Applications/Shared.app",
            "iconUrl": "icon://png-for-Shared.app",
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
});
