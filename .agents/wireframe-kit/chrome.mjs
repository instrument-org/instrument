// A downloaded Chromium, headless, driven over the DevTools protocol with nothing but
// Node's own fetch and WebSocket. check.mjs opens a built page in it. Only a browser a
// tool downloaded is ever run (agent-browser's, Playwright's or Puppeteer's cache, or
// WIREFRAME_CHROME): launching the Chrome installed in Applications from another app
// raises a macOS permission prompt in that app's name, and the kit must never do that.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where the browser-downloading tools keep their builds, by platform. */
const CACHES = {
  darwin: (/** @type {string} */ home) => [
    path.join(home, ".agent-browser", "browsers"),
    path.join(home, "Library", "Caches", "ms-playwright"),
    path.join(home, ".cache", "puppeteer"),
  ],
  win32: (/** @type {string} */ home) => [
    path.join(home, ".agent-browser", "browsers"),
    path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "ms-playwright"),
    path.join(home, ".cache", "puppeteer"),
  ],
  linux: (/** @type {string} */ home) => [
    path.join(home, ".agent-browser", "browsers"),
    path.join(home, ".cache", "ms-playwright"),
    path.join(home, ".cache", "puppeteer"),
  ],
};
/** The headless shell first: a plain binary with no app bundle and no updater. */
const BINARIES = [
  /^chrome-headless-shell(\.exe)?$/,
  /^headless_shell(\.exe)?$/,
  /^Google Chrome for Testing$/,
  /^Chromium$/,
  /^chrome(\.exe)?$/,
];

/** Every file a few levels under dir, as [path, name]; a cache is <cache>/<browser>-<build>/<platform>/<binary>, or that inside an .app bundle. */
function walk(/** @type {string} */ dir, /** @type {number} */ depth) {
  if (depth < 0 || !fs.existsSync(dir)) return /** @type {[string, string][]} */ ([]);
  /** @type {fs.Dirent[]} */
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), depth - 1) : [/** @type {[string, string]} */ ([path.join(dir, e.name), e.name])],
  );
}

/** The downloaded Chromium to run, or an error saying how to get one. WIREFRAME_CHROME names one outright. */
export function findChrome() {
  const override = process.env.WIREFRAME_CHROME;
  if (override) return fs.existsSync(override) ? { bin: override } : { error: `WIREFRAME_CHROME is set to ${override}, which does not exist` };
  const roots = (CACHES[/** @type {keyof typeof CACHES} */ (process.platform)] ?? CACHES.linux)(os.homedir());
  const found = roots.flatMap((root) => walk(root, 6));
  for (const re of BINARIES) {
    // The newest download first: cache folders end in a build number.
    const hits = found
      .filter(([, name]) => re.test(name))
      .map(([p]) => p)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    if (hits[0]) return { bin: hits[0] };
  }
  return {
    error: `no downloaded Chromium in ${roots.join(", ")}. Download one with \`npx playwright install chromium-headless-shell\`, or set WIREFRAME_CHROME to one. The Chrome in Applications is never used.`,
  };
}

/** @template T @param {Promise<T>} promise @param {number} ms @param {string} what @returns {Promise<T>} */
const deadline = (promise, ms, what) => {
  /** @type {NodeJS.Timeout} */
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
};

/**
 * Starts the browser on a blank tab in a throwaway profile. `page.send` is a raw
 * protocol call, `page.on` hears an event, `page.evaluate` runs an expression (awaiting
 * a promise it returns), `page.viewport` sizes the page, `page.navigate` opens a URL and
 * waits for its load event, `page.screenshot` takes a PNG of a clip in page pixels, and
 * `close` stops the browser and deletes the profile.
 */
export async function launch() {
  const { bin, error } = findChrome();
  if (!bin) throw new Error(error);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wireframe-check-"));
  const proc = spawn(
    bin,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const stop = () => {
    try {
      proc.kill("SIGKILL");
    } catch {}
    fs.rmSync(profile, { recursive: true, force: true });
  };
  let stderr = "";
  let wsUrl;
  try {
    wsUrl = await deadline(
    new Promise((resolve, reject) => {
      proc.stderr.on("data", (d) => {
        stderr += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
        if (m) resolve(m[1]);
      });
      proc.on("exit", (code) => reject(new Error(`${bin} exited with ${code} before it was ready: ${stderr.trim().slice(-400) || "no output"}`)));
      proc.on("error", (e) => reject(new Error(`could not start ${bin}: ${e.message}`)));
    }),
    15000,
    "starting Chromium",
  );
  } catch (failure) {
    stop();
    throw failure;
  }
  const port = new URL(wsUrl).port;
  /** @type {{ type: string; webSocketDebuggerUrl: string }[]} */
  const tabs = await deadline(fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()), 5000, "listing the browser's tabs");
  const tab = tabs.find((t) => t.type === "page");
  if (!tab) {
    stop();
    throw new Error("Chromium started with no page tab");
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  try {
  await deadline(
    new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("the DevTools socket failed to open"));
    }),
    5000,
    "opening the DevTools socket",
  );
  } catch (failure) {
    stop();
    throw failure;
  }
  let id = 0;
  /** @type {Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>} */
  const waiting = new Map();
  /** @type {Map<string, ((params: any) => void)[]>} */
  const listeners = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = /** @type {{ resolve: (v: any) => void; reject: (e: Error) => void }} */ (waiting.get(m.id));
      waiting.delete(m.id);
      if (m.error) reject(new Error(`${m.method ?? "DevTools"}: ${m.error.message}`));
      else resolve(m.result);
    } else if (m.method) {
      if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      for (const fn of listeners.get(m.method) ?? []) fn(m.params);
    }
  };
  ws.onclose = () => {
    for (const { reject } of waiting.values()) reject(new Error("Chromium closed the DevTools connection"));
    waiting.clear();
  };
  /** @type {(method: string, params?: Record<string, unknown>, ms?: number) => Promise<any>} */
  const send = (method, params = {}, ms = 20000) =>
    deadline(
      new Promise((resolve, reject) => {
        const i = ++id;
        waiting.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
      ms,
      method,
    );
  /** @type {(method: string, fn: (params: any) => void) => void} */
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  await send("Page.enable");
  await send("Runtime.enable");

  /** @type {(expression: string, ms?: number) => Promise<any>} */
  const evaluate = async (expression, ms = 20000) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, ms);
    if (r.exceptionDetails) throw new Error(`script in the page failed: ${r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  /** @type {(width: number, height: number) => Promise<void>} */
  const viewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  };
  /** @type {(url: string) => Promise<void>} */
  const navigate = async (url) => {
    const loaded = new Promise((resolve) => on("Page.loadEventFired", resolve));
    const r = await send("Page.navigate", { url });
    if (r.errorText) throw new Error(`Chromium could not open ${url}: ${r.errorText}`);
    // A CDN that answers slowly holds the load event; what has rendered is still worth checking.
    await deadline(loaded, 15000, "loading the page").catch(() => {});
  };
  /** @type {(clip: { x: number; y: number; width: number; height: number }) => Promise<Buffer>} */
  const screenshot = async (clip) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...clip, scale: 1 } }, 60000);
    return Buffer.from(r.data, "base64");
  };
  return {
    page: { send, on, evaluate, viewport, navigate, screenshot },
    close: () => {
      try {
        ws.close();
      } catch {}
      stop();
    },
  };
}
