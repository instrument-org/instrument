/**
 * One real headless Chrome standing in for the app's window guests, so every
 * session of a chat reaches the same pages through the CDP bridge, the way
 * they do in the app, rather than each starting a browser of its own. The
 * stand-in window opens, navigates, reads and closes tabs here; the bridge
 * drives them through the `BrowserConfig` this builds. Chrome's own target
 * ids are kept behind the window's `tab_` ids, one flat session per page.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type BrowserConfig, type BrowserTargetId } from "../../src/types";

/**
 * The browser a case with `sharedBrowser` runs: `INSTRUMENT_EVAL_CHROME`, or
 * the newest chrome-headless-shell in Playwright's cache, which
 * `npx playwright install chromium-headless-shell` puts there. The cache is
 * under the account's own home, read from the account rather than `$HOME`,
 * which is the run's sandbox by now. A full Chrome run headless hung opening
 * pages here, so it is not a fallback.
 */
function chromePath(): string {
  if (process.env.INSTRUMENT_EVAL_CHROME) {
    return process.env.INSTRUMENT_EVAL_CHROME;
  }
  const home = os.userInfo().homedir;
  const cache =
    process.platform === "darwin"
      ? path.join(home, "Library/Caches/ms-playwright")
      : process.platform === "win32"
        ? path.join(
            process.env.LOCALAPPDATA ?? path.join(home, "AppData/Local"),
            "ms-playwright",
          )
        : path.join(home, ".cache/ms-playwright");
  // Playwright's Linux arm64 build is Chromium's own `headless_shell`.
  const binaries =
    process.platform === "win32"
      ? ["chrome-headless-shell.exe"]
      : ["chrome-headless-shell", "headless_shell"];
  const builds = fs.existsSync(cache)
    ? fs
        .readdirSync(cache)
        .filter((entry) => entry.startsWith("chromium_headless_shell-"))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    : [];
  for (const build of builds) {
    const root = path.join(cache, build);
    for (const platformDir of fs.readdirSync(root)) {
      for (const binary of binaries) {
        const candidate = path.join(root, platformDir, binary);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new Error(
    "A shared-browser case needs chrome-headless-shell: run `npx playwright install chromium-headless-shell`, or name a binary in INSTRUMENT_EVAL_CHROME.",
  );
}

interface Page {
  chromeId: string;
  destroyed: Set<() => void>;
  listeners: Set<{
    onDetach: () => void;
    onEvent: (method: string, params: unknown, frameSession?: string) => void;
  }>;
  session: string;
  title: string;
  url: string;
}

export interface SharedChrome {
  browser: (base: BrowserConfig) => BrowserConfig;
  close: () => void;
  /** Makes the page for a tab id if there is none, at `url` when given. */
  ensure: (id: string, url?: string) => Promise<void>;
  evaluate: (id: string, expression: string) => Promise<unknown>;
  has: (id: string) => boolean;
  navigate: (id: string, url: string) => Promise<void>;
  pages: () => { id: string; title: string; url: string }[];
  remove: (id: string) => Promise<void>;
}

/**
 * The side every tab is shown in, from `INSTRUMENT_EVAL_VIEWPORT`
 * (`<width>x<height>`, CSS px), standing in for a tab shown in a slot of
 * that size in the app, where the page lays out at the slot's size and an
 * agent's `set viewport` waits until the tab is out of sight. Unset, a tab
 * is Chrome's 1280 by 900 window and the agent's own sizes apply, as for a
 * tab nobody is looking at. `INSTRUMENT_EVAL_VIEWPORT_AFTER` (`<seconds>`)
 * holds each tab at 1280 by 900 until that long after the agent's first
 * command in it, then moves it to the pinned size, as a person opening a
 * split or dragging its divider does mid-task.
 *
 * `INSTRUMENT_EVAL_VIEWPORT_LAYOUT` (`<width>`) starts each tab zoomed to
 * lay out that wide in the side, as the app does for a tab an agent opens
 * in a side narrower than a desktop, down to half size. `INSTRUMENT_EVAL_VIEWPORT_AGENT=1`
 * honors the agent's `set viewport` the way the app does for a tab on
 * screen: the page lays out at the width asked for, zoomed to fit the side,
 * its height following the side's, and a clear goes back to the default.
 */
function pinnedViewport():
  | undefined
  | {
      afterMs: number;
      agent: boolean;
      height: number;
      layout: number;
      width: number;
    } {
  const match = /^(\d+)x(\d+)$/.exec(
    process.env.INSTRUMENT_EVAL_VIEWPORT ?? "",
  );
  if (!match) {
    return undefined;
  }
  const after = Number(process.env.INSTRUMENT_EVAL_VIEWPORT_AFTER ?? "0");
  const width = Number(match[1]);
  const layout = Number(process.env.INSTRUMENT_EVAL_VIEWPORT_LAYOUT ?? "");
  return {
    afterMs: Number.isFinite(after) ? after * 1000 : 0,
    agent: process.env.INSTRUMENT_EVAL_VIEWPORT_AGENT === "1",
    height: Number(match[2]),
    // As the app zooms an agent's page: only in a side narrower than the
    // layout width, and no further out than half size.
    layout:
      Number.isInteger(layout) && layout > width
        ? Math.min(layout, width / 0.5)
        : width,
    width,
  };
}

/**
 * Device pixels per CSS px of the screen the side is on, from
 * `INSTRUMENT_EVAL_SCREEN_SCALE`; 2 by default, a Mac's Retina screen. A
 * page zoomed to fit is drawn at this times its zoom, as the app draws it,
 * so a screenshot the agent takes has the app's pixels.
 */
function screenScale(): number {
  const scale = Number(process.env.INSTRUMENT_EVAL_SCREEN_SCALE ?? "2");
  return Number.isFinite(scale) && scale > 0 ? scale : 2;
}

/** The page zoom the app's browser allows (`BROWSER_ZOOM_MIN` and `BROWSER_ZOOM_MAX`). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;

/**
 * The metrics that lay a page out `layout` CSS px wide in a side, zoomed to
 * fit it within the zoom the app allows: the page is drawn at the side's
 * width, and its height is the side's at that zoom.
 */
function zoomedMetrics(
  side: { height: number; width: number },
  layout: number,
) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, side.width / layout));
  return {
    deviceScaleFactor: screenScale() * zoom,
    height: Math.round(side.height / zoom),
    mobile: false,
    width: Math.round(side.width / zoom),
  };
}

/** The width an agent's `setDeviceMetricsOverride` asks for, or nothing for 0, which turns the override off. */
function askedWidth(params: unknown): number | undefined {
  return typeof params === "object" &&
    params !== null &&
    "width" in params &&
    typeof params.width === "number" &&
    params.width > 0
    ? params.width
    : undefined;
}

/** What the pinned viewport refused or did, appended to `$HOME/.eval-viewport.jsonl` for a case to read. */
function noteViewport(entry: Record<string, unknown>) {
  try {
    fs.appendFileSync(
      path.join(os.homedir(), ".eval-viewport.jsonl"),
      `${JSON.stringify({ at: Date.now(), ...entry })}\n`,
    );
  } catch {
    // A note that cannot be written changes nothing about the run.
  }
}

let current: SharedChrome | undefined;

/** The run's shared Chrome, for a case's teardown to read its pages. */
export function getSharedChrome(): SharedChrome | undefined {
  return current;
}

export function setSharedChrome(chrome: SharedChrome | undefined): void {
  current = chrome;
}

export async function launchSharedChrome(): Promise<SharedChrome> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shared-chrome-"));
  const child = spawn(
    chromePath(),
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  /** Ends the browser and removes its profile, whether it came up or not. */
  const stop = () => {
    child.kill();
    try {
      fs.rmSync(profile, { force: true, maxRetries: 3, recursive: true });
    } catch {
      // Chrome may still be writing its profile as it exits.
    }
  };
  let ws: WebSocket;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let buffered = "";
      const timer = setTimeout(() => {
        reject(new Error("headless Chrome did not print its endpoint"));
      }, 15_000);
      child.stderr.on("data", (chunk: Buffer) => {
        buffered += chunk.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffered);
        if (match?.[1]) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on("error", reject);
      child.on("exit", () => {
        reject(new Error("headless Chrome exited"));
      });
    });
    ws = new WebSocket(endpoint, { perMessageDeflate: false });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        resolve();
      });
      ws.once("error", reject);
    });
  } catch (error) {
    stop();
    throw error;
  }

  let nextId = 1;
  const pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: unknown) => void }
  >();
  const pages = new Map<string, Page>();
  const bySession = new Map<string, string>();
  /** A frame's session, by the page it belongs to. */
  const frameOf = new Map<string, string>();
  const creating = new Map<string, Promise<void>>();

  const send = (
    method: string,
    params: unknown = {},
    sessionId?: string,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { reject, resolve });
      ws.send(
        JSON.stringify({
          id,
          method,
          params: params ?? {},
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });

  ws.on("message", (data: Buffer) => {
    // A CDP frame from Chrome; its shape is Chrome's.
    const message = JSON.parse(data.toString()) as {
      error?: { message: string };
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      sessionId?: string;
    };
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        waiter?.reject(new Error(message.error.message));
      } else {
        waiter?.resolve(message.result ?? {});
      }
      return;
    }
    const { method = "", params = {}, sessionId } = message;
    if (method === "Target.targetInfoChanged") {
      const info = params.targetInfo as {
        targetId: string;
        title: string;
        url: string;
      };
      for (const page of pages.values()) {
        if (page.chromeId === info.targetId && page.url !== info.url) {
          page.url = info.url;
          page.title = info.title;
        }
      }
      return;
    }
    if (method === "Target.targetDestroyed") {
      for (const [id, page] of pages) {
        if (page.chromeId === params.targetId) {
          pages.delete(id);
          for (const listener of page.listeners) {
            listener.onDetach();
          }
          for (const done of page.destroyed) {
            done();
          }
        }
      }
      return;
    }
    if (sessionId === undefined) {
      return;
    }
    const pageId = bySession.get(sessionId);
    if (pageId !== undefined) {
      if (method === "Target.attachedToTarget") {
        frameOf.set(String(params.sessionId), pageId);
      }
      if (method === "Page.loadEventFired") {
        // The target's own title can lag the page's; the window shows the page's.
        void send(
          "Runtime.evaluate",
          { expression: "document.title", returnByValue: true },
          sessionId,
        )
          .then((result) => {
            const title = (result as { result?: { value?: unknown } }).result
              ?.value;
            const page = pages.get(pageId);
            if (page && typeof title === "string" && title) {
              page.title = title;
            }
          })
          .catch(() => undefined);
      }
      for (const listener of pages.get(pageId)?.listeners ?? []) {
        listener.onEvent(method, params);
      }
      return;
    }
    const owner = frameOf.get(sessionId);
    if (owner !== undefined) {
      if (method === "Target.attachedToTarget") {
        frameOf.set(String(params.sessionId), owner);
      }
      for (const listener of pages.get(owner)?.listeners ?? []) {
        listener.onEvent(method, params, sessionId);
      }
    }
  });
  await send("Target.setDiscoverTargets", { discover: true });

  const pinned = pinnedViewport();
  const pinSize = async (sessionId: string) => {
    if (!pinned) {
      return;
    }
    await send(
      "Emulation.setDeviceMetricsOverride",
      zoomedMetrics(pinned, pinned.layout),
      sessionId,
    );
  };
  /** Pages whose move to the pinned size is set or done, for `INSTRUMENT_EVAL_VIEWPORT_AFTER`. */
  const shiftScheduled = new Set<string>();

  const ensure = async (id: string, url?: string) => {
    if (pages.has(id)) {
      return;
    }
    const already = creating.get(id);
    if (already) {
      await already;
      return;
    }
    const made = (async () => {
      const { targetId } = (await send("Target.createTarget", {
        url: "about:blank",
      })) as { targetId: string };
      const { sessionId } = (await send("Target.attachToTarget", {
        flatten: true,
        targetId,
      })) as { sessionId: string };
      bySession.set(sessionId, id);
      if (pinned && pinned.afterMs === 0) {
        await pinSize(sessionId);
      }
      pages.set(id, {
        chromeId: targetId,
        destroyed: new Set(),
        listeners: new Set(),
        session: sessionId,
        title: "",
        url: "about:blank",
      });
      if (url && url !== "about:blank") {
        await navigate(id, url);
      }
    })();
    creating.set(id, made);
    try {
      await made;
    } finally {
      creating.delete(id);
    }
  };

  const navigate = async (id: string, url: string) => {
    const page = pages.get(id);
    if (!page) {
      return;
    }
    await send("Page.enable", {}, page.session);
    const loaded = new Promise<void>((resolve) => {
      const listener = {
        onDetach: resolve,
        onEvent: (method: string) => {
          if (method === "Page.loadEventFired") {
            page.listeners.delete(listener);
            resolve();
          }
        },
      };
      page.listeners.add(listener);
      setTimeout(resolve, 10_000);
    });
    await send("Page.navigate", { url }, page.session);
    await loaded;
  };

  const evaluate = async (id: string, expression: string) => {
    const page = pages.get(id);
    if (!page) {
      return undefined;
    }
    const result = (await send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      page.session,
    )) as { result?: { value?: unknown } };
    return result.result?.value;
  };

  const remove = async (id: string) => {
    const page = pages.get(id);
    if (page) {
      await send("Target.closeTarget", { targetId: page.chromeId }).catch(
        () => undefined,
      );
    }
  };

  const partitionDir = AbsolutePathSchema.parse(profile);

  return {
    browser: (base) => ({
      ...base,
      closeTarget: (targetId) => remove(targetId),
      createTarget: (targetId) => ensure(targetId),
      getTargetMeta: (targetId) =>
        pages.has(targetId) ? { partitionDir } : null,
      getTargetUrl: (targetId) => pages.get(targetId)?.url,
      hasNoWindow: false,
      listTargets: () =>
        Promise.resolve(
          [...pages.entries()].map(([id, page]) => ({
            // The window's own ids are the keys here.
            id: id as BrowserTargetId,
            title: page.title,
            type: "page" as const,
            url: page.url,
          })),
        ),
      loadPage: async (targetId, url) => {
        const page = pages.get(targetId);
        if (!page) {
          throw new Error(`No target ${targetId}`);
        }
        await send("Page.navigate", { url }, page.session);
      },
      onTargetDestroyed: (targetId, listener) => {
        const page = pages.get(targetId);
        page?.destroyed.add(listener);
        return () => page?.destroyed.delete(listener);
      },
      sendCommand: ((
        targetId: BrowserTargetId,
        method: string,
        params: unknown,
        frameSession?: string,
      ) => {
        const page = pages.get(targetId);
        if (!page) {
          return Promise.reject(new Error(`No target ${targetId}`));
        }
        // agent-browser's `set viewport` resizes the window to match, which
        // the app answers itself without touching the guest.
        if (method === "Browser.setContentsSize") {
          return Promise.resolve({});
        }
        // A browser-level command naming a tab names it by the window's id,
        // which Chrome never answers for: the session stops responding.
        if (
          method.startsWith("Browser.") &&
          typeof params === "object" &&
          params !== null &&
          "targetId" in params
        ) {
          return send(
            method,
            { ...params, targetId: page.chromeId },
            page.session,
          );
        }
        if (
          pinned &&
          (method === "Emulation.setDeviceMetricsOverride" ||
            method === "Emulation.clearDeviceMetricsOverride")
        ) {
          if (!pinned.agent) {
            // A shown tab keeps its slot's size in the app.
            noteViewport({ asked: params, method, refused: true });
            return Promise.resolve({});
          }
          const asked =
            method === "Emulation.setDeviceMetricsOverride"
              ? askedWidth(params)
              : undefined;
          const applied = zoomedMetrics(pinned, asked ?? pinned.layout);
          noteViewport({ applied, asked: params, method, tab: targetId });
          return send(
            "Emulation.setDeviceMetricsOverride",
            applied,
            page.session,
          );
        }
        if (pinned && pinned.afterMs > 0 && !shiftScheduled.has(targetId)) {
          shiftScheduled.add(targetId);
          const session = page.session;
          setTimeout(() => {
            void pinSize(session)
              .then(() => {
                noteViewport({ shifted: targetId });
              })
              .catch(() => undefined);
          }, pinned.afterMs).unref();
        }
        return send(method, params, frameSession ?? page.session);
        // The overloads of sendCommand are one function at runtime.
      }) as BrowserConfig["sendCommand"],
      subscribeEvents: (targetId, onDetach, onEvent) => {
        const page = pages.get(targetId);
        if (!page) {
          onDetach();
          return () => undefined;
        }
        const listener = { onDetach, onEvent };
        page.listeners.add(listener);
        return () => page.listeners.delete(listener);
      },
    }),
    close: () => {
      ws.close();
      stop();
    },
    ensure,
    evaluate,
    has: (id) => pages.has(id),
    navigate,
    pages: () =>
      [...pages.entries()].map(([id, page]) => ({
        id,
        title: page.title,
        url: page.url,
      })),
    remove,
  };
}
