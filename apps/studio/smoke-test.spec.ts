import { APP_EXECUTABLE, APP_NAME } from "@instrument-org/shared";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import { noop } from "radashi";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCREENSHOTS_DIR = path.join(process.cwd(), "smoke-test-screenshots");

function runPnpmScript(
  script: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["run", script], {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `pnpm run ${script} failed with code ${String(code)}${signal == null ? "" : ` signal ${signal}`}`,
        ),
      );
    });
  });
}

const isAppWindow = (url: string) => url.includes("#/");

/** A port nothing is listening on, for the app's DevTools endpoint. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("no port assigned"));
        }
      });
    });
  });
}

/** Connects to the app's DevTools endpoint once it is listening. */
async function connectWhenListening(
  port: number,
  timeoutMs: number,
): Promise<Browser> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** The archive the packaged app actually loads its dependencies from. */
function asarPath(executablePath: string): string {
  const resources =
    process.platform === "darwin"
      ? path.resolve(path.dirname(executablePath), "../Resources")
      : path.join(path.dirname(executablePath), "resources");
  return path.join(resources, "app.asar");
}

async function resolveExecutablePath(distPath: string): Promise<string> {
  const platform = process.platform;

  if (platform === "win32") {
    return path.join(distPath, `win-unpacked/${APP_NAME}.exe`);
  }
  if (platform !== "darwin") {
    return path.join(distPath, `linux-unpacked/${APP_EXECUTABLE}`);
  }

  // Fall back to the last spelling so the caller's own access check reports
  // the missing path, with the dist listing it already prints.
  let executablePath = "";
  for (const dir of ["mac-arm64", "mac-x64", "mac"]) {
    executablePath = path.join(
      distPath,
      `${dir}/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`,
    );
    try {
      await fs.access(executablePath);
      return executablePath;
    } catch {
      // Try the next architecture directory.
    }
  }
  return executablePath;
}

function runAsNode(
  executablePath: string,
  script: string,
): Promise<{ code: null | number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["-e", script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 60_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

describe("Studio Smoke Test", () => {
  let distPath: string;
  let tempUserDataDir: string;

  beforeAll(async () => {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    // Must run the app outside of the monorepo to avoid inheriting node modules
    distPath = await fs.mkdtemp(
      path.join(tmpdir(), `${APP_EXECUTABLE}-smoke-app-`),
    );
    tempUserDataDir = await fs.mkdtemp(
      path.join(tmpdir(), `${APP_EXECUTABLE}-smoke-test-`),
    );

    await runPnpmScript("build:env:unsigned", {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_BUILDER_OUTPUT_DIR: distPath,
      },
    });
  }, 300_000);

  afterAll(async () => {
    // Windows keeps a handle on the packaged executable for a moment after the
    // app exits, so the unlink needs retries -- and cleanup of a temp directory
    // must never turn a passing suite red.
    for (const dir of [distPath, tempUserDataDir]) {
      try {
        await fs.rm(dir, {
          force: true,
          maxRetries: 10,
          recursive: true,
          retryDelay: 200,
        });
      } catch (error) {
        console.warn(`Could not remove ${dir}:`, error);
      }
    }
  });

  it("should not contain monorepo paths baked into compiled bundles", async () => {
    // Guards against build-time path resolution leaking into the bundle as a
    // hardcoded string (e.g. require.resolve() in dev mode). First caught with
    // ffmpeg-static: the app passed the smoke test but launched with no window
    // on any other machine. Only main/preload run in Node and can do fs requires;
    // the renderer is irrelevant here.
    const repoRoot = path.resolve(process.cwd(), "../..");
    // Check both slash styles -- vite may normalize to "/" even on Windows.
    const repoRootForward = repoRoot.replaceAll("\\", "/");

    const bundleFiles = [
      path.join(process.cwd(), "out/main/index.js"),
      path.join(process.cwd(), "out/preload/index.mjs"),
    ];

    for (const bundleFile of bundleFiles) {
      const label = `${path.basename(path.dirname(bundleFile))}/${path.basename(bundleFile)}`;
      const content = await fs.readFile(bundleFile, "utf8");

      for (const needle of [repoRoot, repoRootForward]) {
        const idx = content.indexOf(needle);
        if (idx === -1) {
          continue;
        }

        // Snippet avoids vitest diffing the entire bundle (thousands of lines).
        const snippetStart = Math.max(0, idx - 60);
        const snippetEnd = Math.min(content.length, idx + needle.length + 60);
        const snippet = content.slice(snippetStart, snippetEnd).trim();
        expect.fail(
          `${label} contains a baked-in monorepo path.\n` +
            `  needle: ${needle}\n` +
            `  context: ...${snippet}...`,
        );
      }
    }
  });

  // The agent's shell reaches its heavier commands through files resolved at
  // runtime -- a worker beside the bundle entry, a wasm blob next to it -- and
  // packaging decides whether those are still there. Nothing in the dev test
  // suite can see that, because it runs against node_modules. So run those
  // commands through the archive the shipped app loads, under the shipped
  // runtime: sqlite3 needs its worker, a worker thread to load it, and sql.js
  // to read wasm out of the archive; python3 needs its own worker and the
  // vendored CPython wasm and stdlib zip; js-exec needs its worker and the one
  // quickjs-emscripten variant the build keeps.
  it("runs bash commands from inside the packaged archive", async () => {
    const executablePath = await resolveExecutablePath(distPath);
    const nodeModules = path.join(asarPath(executablePath), "node_modules");

    const { code, stderr, stdout } = await runAsNode(
      executablePath,
      `
      const path = require("node:path");
      const { pathToFileURL } = require("node:url");
      (async () => {
        // The app imports just-bash as ESM; require.resolve would hand back
        // the CommonJS entry, which is a different bundle with different
        // chunk wiring, and the package's exports map does not expose its
        // manifest anyway. Read the import condition off the manifest.
        const packageDir = path.join(${JSON.stringify(nodeModules)}, "just-bash");
        const manifest = require(path.join(packageDir, "package.json"));
        const entry = path.join(packageDir, manifest.exports["."].import.default);
        const { Bash } = await import(pathToFileURL(entry).href);
        const bash = new Bash({ commands: ["sqlite3"], javascript: true, python: true });
        const result = await bash.exec(
          "sqlite3 /db 'create table t(a); insert into t values(41); select a+1 from t;'",
        );
        const python = await bash.exec("python3 -c 'import json; print(json.dumps(6 * 7))'");
        const jsExec = await bash.exec("js-exec -c 'console.log(6 * 7)'");
        // js-exec keeps its worker for reuse past the end of the script, so
        // the process has to be told it is finished.
        process.stdout.write("SANDBOX_SMOKE " + JSON.stringify({ entry, jsExec, python, result }) + "\\n", () => process.exit(0));
      })().catch((error) => {
        process.stdout.write("SANDBOX_SMOKE_ERROR " + String(error && error.stack ? error.stack : error) + "\\n");
        process.exit(1);
      });
      `,
    );

    const line = stdout
      .split("\n")
      .find((entry) => entry.startsWith("SANDBOX_SMOKE"));
    expect(
      line?.startsWith("SANDBOX_SMOKE "),
      `sandbox probe did not report a result.\nstdout: ${stdout}\nstderr: ${stderr}`,
    ).toBe(true);

    interface Run {
      exitCode: number;
      stderr: string;
      stdout: string;
    }
    const parsed = JSON.parse((line ?? "").slice("SANDBOX_SMOKE ".length)) as {
      entry: string;
      jsExec: Run;
      python: Run;
      result: Run;
    };

    expect(parsed.entry).toContain("app.asar");
    for (const [name, run] of Object.entries({
      "js-exec": parsed.jsExec,
      python3: parsed.python,
      sqlite3: parsed.result,
    })) {
      expect(run.stderr, `${name} stderr`).toBe("");
      expect(run.stdout.trim(), `${name} stdout`).toBe("42");
      expect(run.exitCode, `${name} exit code`).toBe(0);
    }
    expect(code).toBe(0);
  }, 120_000);

  // ripgrep and uv already run their `--version` in the afterPack hook. These
  // three do not, and each finds its binary through its own package's path
  // math, so resolve them the way the app does rather than by hand: a binary
  // still inside the archive cannot be executed at all, and a foreign-arch one
  // left behind by pruning only fails when something runs it.
  it("runs the vendored binaries the sandbox shells out to", async () => {
    const executablePath = await resolveExecutablePath(distPath);
    const nodeModules = path.join(asarPath(executablePath), "node_modules");

    const { code, stderr, stdout } = await runAsNode(
      executablePath,
      `
      const path = require("node:path");
      const { execFileSync } = require("node:child_process");
      const { createRequire } = require("node:module");
      try {
        const req = createRequire(path.join(${JSON.stringify(nodeModules)}, "probe.js"));
        // ffmpeg-ffprobe-static exports paths into the archive; the app
        // rewrites them the same way to reach the executable copies.
        const unpack = (binary) =>
          binary.replace(/[\\\\/]app\\.asar[\\\\/]/, path.sep + "app.asar.unpacked" + path.sep);
        const ffmpeg = req("ffmpeg-ffprobe-static");
        const probes = [
          ["ffmpeg", unpack(ffmpeg.ffmpegPath), "-version"],
          ["ffprobe", unpack(ffmpeg.ffprobePath), "-version"],
          ["git", req("dugite").resolveGitBinary(), "--version"],
        ];
        const report = {};
        for (const [name, binary, flag] of probes) {
          report[name] = {
            binary,
            version: execFileSync(binary, [flag], { encoding: "utf8" }).split("\\n")[0],
          };
        }
        process.stdout.write("SANDBOX_BINARIES " + JSON.stringify(report) + "\\n");
      } catch (error) {
        process.stdout.write("SANDBOX_BINARIES_ERROR " + String(error && error.stack ? error.stack : error) + "\\n");
        process.exit(1);
      }
      `,
    );

    const line = stdout
      .split("\n")
      .find((entry) => entry.startsWith("SANDBOX_BINARIES"));
    expect(
      line?.startsWith("SANDBOX_BINARIES "),
      `binary probe did not report a result.\nstdout: ${stdout}\nstderr: ${stderr}`,
    ).toBe(true);

    const report = JSON.parse(
      (line ?? "").slice("SANDBOX_BINARIES ".length),
    ) as Record<string, { binary: string; version: string }>;

    for (const [name, expected] of [
      ["ffmpeg", /^ffmpeg version /],
      ["ffprobe", /^ffprobe version /],
      ["git", /^git version /],
    ] as const) {
      expect(report[name]?.version, `${name} --version`).toMatch(expected);
      expect(
        report[name]?.binary,
        `${name} runs from outside the archive`,
      ).toContain("app.asar.unpacked");
    }
    expect(code).toBe(0);
  }, 120_000);

  it("should launch the app and verify basic functionality", async () => {
    const executablePath = await resolveExecutablePath(distPath);

    try {
      await fs.access(executablePath);
    } catch {
      let distContents = "unable to read dist directory";
      try {
        const files = await fs.readdir(distPath);
        distContents = files.join(", ");
      } catch {
        // Keep default message
      }
      throw new Error(
        `Executable not found at: ${executablePath}\nAvailable dist contents: ${distContents}`,
      );
    }

    // Some editor integrations export ELECTRON_RUN_AS_NODE, and a GUI launch
    // that inherits it runs as plain Node: no window, no output, no crash
    // report, which reads like a signing or bundle failure rather than an
    // environment one.
    const appEnv: NodeJS.ProcessEnv = { ...process.env };
    delete appEnv.ELECTRON_RUN_AS_NODE;

    // Attached over Chromium's DevTools endpoint rather than Playwright's
    // electron.launch, which waits on a main-process `--inspect` debugger that
    // the packaged app's EnableNodeCliInspectArguments fuse refuses. This
    // drives the binary exactly as it ships.
    const port = await freePort();
    const childProcess = spawn(
      executablePath,
      [
        ...(process.platform === "linux"
          ? ["--no-sandbox", "--disable-gpu"]
          : []),
        `--remote-debugging-port=${port}`,
      ],
      {
        env: {
          ...appEnv,
          DISABLE_AUTO_UPDATE_POLLING: "true",
          ELECTRON_ENABLE_CONSOLE_LOGGING: "true",
          ELECTRON_USER_DATA_DIR: tempUserDataDir,
          SKIP_MOVE_TO_APPLICATIONS: "true",
          SKIP_ONBOARDING: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = new Promise<void>((resolve) => {
      childProcess.once("exit", () => {
        resolve();
      });
    });

    childProcess.stdout.on("data", (data: Buffer | string) => {
      console.log(Buffer.isBuffer(data) ? data.toString("utf8") : data);
    });

    childProcess.stderr.on("data", (data: Buffer | string) => {
      console.error(Buffer.isBuffer(data) ? data.toString("utf8") : data);
    });

    const browser = await connectWhenListening(port, 60_000);
    const windows = () =>
      browser.contexts().flatMap((context) => context.pages());

    // The app runs with SKIP_ONBOARDING, so only the AppShell window launches;
    // locate it by URL rather than index since ordering isn't guaranteed.
    const startTime = Date.now();

    let appWindow = windows().find((w) => isAppWindow(w.url()));
    while (!appWindow && Date.now() - startTime < 30_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      appWindow = windows().find((w) => isAppWindow(w.url()));
    }

    const windowUrls = windows().map((w) => w.url());
    expect(
      appWindow,
      `app window found (all window URLs: ${windowUrls.join(", ")})`,
    ).toBeDefined();

    if (!appWindow) {
      throw new Error(`app window not found. URLs: ${windowUrls.join(", ")}`);
    }

    appWindow.on("console", (msg) => {
      console.log(msg.text());
    });

    const windowConfigs = [
      { name: "app", state: "visible", testId: "app-page", window: appWindow },
    ] as const;

    for (const { name, state, testId, window } of windowConfigs) {
      const locator = window.locator(`[data-testid="${testId}"]`);
      await locator.waitFor({ state, timeout: 30_000 });
      expect(
        await locator.count(),
        `${name} window: [data-testid="${testId}"] element found`,
      ).toBe(1);
    }

    const osSuffix = process.platform;
    await Promise.all(
      windowConfigs.map(async ({ name, window }) => {
        await window
          .screenshot({
            path: path.join(SCREENSHOTS_DIR, `${name}-window-${osSuffix}.png`),
            scale: "css",
          })
          .catch(() => noop);
      }),
    );

    await browser.close();
    childProcess.kill();
    await exited;

    const requiredPaths = [
      path.join(tempUserDataDir, "bin"),
      path.join(tempUserDataDir, "machine-state.json"),
      path.join(
        tempUserDataDir,
        "workspace",
        ".instrument",
        "settings",
        "preferences.json",
      ),
    ];

    for (const filePath of requiredPaths) {
      let exists = true;
      try {
        await fs.access(filePath);
      } catch {
        exists = false;
      }
      expect(exists, `File exists: ${filePath}`).toBe(true);
    }

    // Validate machine-state.json was written at boot: the first launch
    // generates this computer's telemetry id there.
    const appStateContent = await fs.readFile(
      path.join(tempUserDataDir, "machine-state.json"),
      "utf8",
    );
    const appState = JSON.parse(appStateContent) as {
      telemetryId?: string;
    };
    expect(
      appState.telemetryId,
      "machine-state.json: telemetryId is generated on first launch",
    ).toMatch(/^anon-/);
  });
});
