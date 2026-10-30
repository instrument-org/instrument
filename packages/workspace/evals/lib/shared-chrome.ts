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
