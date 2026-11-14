// Keeps the app under test from reaching the screen of the person at this
// Mac. Over the main process's inspector it replaces the three calls that put
// something up outside the app's own window (the system browser, the system's
// file picker, a native message box) with ones that only record what was
// asked for. The tester is then told, in a person's terms, what came up.
//
// This changes the running process only; no file in the repo is touched.

import { connect } from "./screen.mjs";

const INSTALL = `(() => {
  if (globalThis.__outside) return "already";
  const electron = process.getBuiltinModule("node:module")
    .createRequire(process.execPath)("electron");
  const events = [];
  globalThis.__outside = { events, dialogAnswers: [] };
  const record = (kind, detail) => events.push({ at: Date.now(), detail, kind });
  electron.shell.openExternal = async (url) => { record("browser", String(url)); };
  electron.shell.openPath = async (path) => { record("open-file", String(path)); return ""; };
  electron.shell.showItemInFolder = (path) => { record("show-in-finder", String(path)); };
  const options = (args) => args.find((arg) => arg && typeof arg === "object" && !arg.webContents) ?? {};
  electron.dialog.showOpenDialog = async (...args) => {
    const asked = options(args);
    record("file-picker", { properties: asked.properties, title: asked.title, buttonLabel: asked.buttonLabel, message: asked.message });
    const answer = globalThis.__outside.dialogAnswers.shift();
    return answer ? { canceled: false, filePaths: [answer] } : { canceled: true, filePaths: [] };
  };
  electron.dialog.showMessageBox = async (...args) => {
    const asked = options(args);
    record("message-box", { buttons: asked.buttons, detail: asked.detail, message: asked.message });
    return { checkboxChecked: false, response: asked.cancelId ?? 0 };
  };
  // Whether this process is on its way out (the app restarting itself, or
  // quitting), so nothing is done to a window that is about to go.
  globalThis.__outside.leaving = false;
  const leave = () => { globalThis.__outside.leaving = true; };
  electron.app.on("before-quit", leave);
  electron.app.on("will-quit", leave);
  const exit = electron.app.exit.bind(electron.app);
  electron.app.exit = (code) => { leave(); exit(code); };
  // A notification is recorded rather than posted on the real screen, where
  // clicking it would bring the app's window to the front.
  electron.Notification.prototype.show = function () {
    record("notification", { body: this.body, title: this.title });
  };
  // A native menu (a right-click menu the system draws) is kept instead of
  // shown, so the tester can be told its items and pick one by name.
  electron.Menu.prototype.popup = function () {
    const items = this.items
      .filter((item) => item.visible !== false && item.type !== "separator")
      .map((item) => ({ enabled: item.enabled !== false, label: item.label }));
    globalThis.__outside.menu = this;
    record("menu", items);
  };
  globalThis.__outside.pick = (label) => {
    const menu = globalThis.__outside.menu;
    const item = menu?.items.find((each) => each.label === label && each.enabled !== false);
    if (!item) return false;
    globalThis.__outside.menu = undefined;
    item.click(undefined, electron.BrowserWindow.getAllWindows()[0], undefined);
    return true;
  };
  // The picture of the screen, taken by the app's own capture. The debug
  // protocol's screenshot of a window that has never been on a display draws
  // the pages embedded in it (a web page, an HTML file's preview) at the
  // wrong size and never again, so a whole page looked cut off after its
  // first screenful. This capture draws them as the display would. It is of
  // the newest of the app's own windows, in the window's points, and marks
  // that window's page so the pointer goes to the same one.
  globalThis.__outside.capture = async (cropBottom = 0) => {
    const own = electron.webContents
      .getAllWebContents()
      .filter((each) => !each.isDestroyed() && each.getType() === "window" && each.getURL().includes("/renderer/"))
      .sort((a, b) => b.id - a.id);
    const contents = own[0];
    const win = contents && electron.BrowserWindow.fromWebContents(contents);
    if (!win) return null;
    const [width, full] = win.getContentSize();
    const height = full - cropBottom;
    const image = await contents.capturePage();
    contents.executeJavaScript("globalThis.__screenOf = " + contents.id + "; 0").catch(() => {});
    return {
      height,
      id: contents.id,
      png: image.isEmpty() ? "" : image.resize({ height: full, quality: "best", width }).crop({ height, width, x: 0, y: 0 }).toPNG().toString("base64"),
      width,
      zoom: contents.getZoomFactor(),
    };
  };
  // A page embedded in the app (the in-app browser, a file's preview) can ask
  // for a file or raise an alert, either of which the system draws as a
  // window of its own, on the real screen. The harness keeps no debugger on
  // those pages, since the app's agent drives them with its own, so each
  // one is told in its own script to record the request instead.
  const QUIET = \`(() => {
    if (globalThis.__quiet) return;
    globalThis.__quiet = true;
    const say = (what) => console.info("__outside__:" + what);
    const isFile = (node) => node instanceof HTMLInputElement && node.type === "file";
    addEventListener("click", (event) => {
      const input = event.composedPath().find(isFile);
      if (input) { event.preventDefault(); event.stopImmediatePropagation(); say("file-chooser"); }
    }, true);
    for (const method of ["click", "showPicker"]) {
      const original = HTMLInputElement.prototype[method];
      HTMLInputElement.prototype[method] = function (...args) {
        if (isFile(this)) { say("file-chooser"); return; }
        return original.apply(this, args);
      };
    }
    for (const picker of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) {
      if (picker in globalThis) globalThis[picker] = async () => { say("file-chooser"); throw new DOMException("The user aborted a request.", "AbortError"); };
    }
    globalThis.alert = (message) => { say("alert:" + String(message ?? "")); };
    globalThis.confirm = (message) => { say("alert:" + String(message ?? "")); return false; };
    globalThis.prompt = (message) => { say("alert:" + String(message ?? "")); return null; };
    globalThis.print = () => { say("print"); };
  })()\`;
  const quiet = (contents) => {
    if (contents.isDestroyed() || contents.getType() !== "webview") return;
    const tell = () => {
      try {
        for (const frame of contents.mainFrame.framesInSubtree) frame.executeJavaScript(QUIET).catch(() => {});
      } catch {}
    };
    contents.on("dom-ready", tell);
    contents.on("did-frame-finish-load", tell);
    contents.on("did-navigate-in-page", tell);
    contents.on("console-message", (...args) => {
      const message = args.find((arg) => typeof arg === "string" && arg.startsWith("__outside__:")) ?? (typeof args[0]?.message === "string" && args[0].message.startsWith("__outside__:") ? args[0].message : null);
      if (!message) return;
      const what = message.slice("__outside__:".length);
      if (what === "file-chooser") record("page-file-chooser", null);
      else if (what === "print") record("page-print", null);
      else record("page-alert", what.slice("alert:".length));
    });
    tell();
  };
  electron.app.on("web-contents-created", (_event, contents) => quiet(contents));
  for (const contents of electron.webContents.getAllWebContents()) quiet(contents);
  return "installed";
})()`;

/**
 * The guard on the main process behind `inspectPort`. The app can restart
 * itself (moving its folder does), which starts a new main process with
 * nothing installed, so every call connects again if it has to and installs
 * the guard where it is missing. `ensure` before each action keeps a click
 * from ever reaching a process that is not guarded yet.
 */
export async function guardOutside({ inspectPort }) {
  let cdp;
  const evaluateOnce = async (expression) => {
    if (!cdp || cdp.closed) {
      const response = await fetch(`http://127.0.0.1:${inspectPort}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      const [target] = await response.json();
      cdp = await connect(target.webSocketDebuggerUrl);
    }
    const { exceptionDetails, result } = await cdp.send(
      "Runtime.evaluate",
      { awaitPromise: true, expression, returnByValue: true },
      5000,
    );
    if (exceptionDetails) {
      throw new Error(
        `main process: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
      );
    }
    return result.value;
  };
  // The connection is closed after every use, and this is what the whole
  // harness turns on: a Node process that is quitting waits for an attached
  // debugger to disconnect. Held open, this connection kept the old main
  // process alive through the app's restart, still owning the debug port and
  // answering nothing, so the new one never came up.
  //
  // A main process that is starting answers nothing for a while, so this
  // tries again on a new connection, for a minute at most.
  const evaluate = async (expression) => {
    let last;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        return await evaluateOnce(expression);
      } catch (error) {
        last = error;
        if (String(error.message).startsWith("main process:")) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } finally {
        cdp?.close();
        cdp = undefined;
      }
    }
    throw new Error(`the app's main process did not answer (${last?.message})`);
  };
  /** Drops the connection, so the next call makes a new one. */
  const reconnect = () => {
    cdp?.close();
    cdp = undefined;
  };
  const ensure = () => evaluate(INSTALL);
  /**
   * The main process as it stands, asked once: its pid and whether it is on
   * its way out. Null when none answers, which is the gap between one
   * process and the next during a restart.
   */
  const peek = async () => {
    try {
      return await evaluateOnce(
        "({ leaving: globalThis.__outside?.leaving ?? false, pid: process.pid })",
      );
    } catch {
      return null;
    } finally {
      cdp?.close();
      cdp = undefined;
    }
  };
  const installed = await ensure();
  return {
    close: () => cdp?.close(),
    /** What the app asked the system for since the last call. */
    drain: async () => {
      await ensure();
      return evaluate("globalThis.__outside.events.splice(0)");
    },
    /** The screen as the app's own capture draws it, or null with no window. */
    capture: async (cropBottom = 0) => {
      await ensure();
      const shot = await evaluate(`globalThis.__outside.capture(${Number(cropBottom)})`);
      return shot && { ...shot, png: Buffer.from(shot.png, "base64") };
    },
    ensure,
    installed,
    peek,
    reconnect,
    /** Chooses an item of the native menu last put up, by its label. */
    pickMenuItem: (label) =>
      evaluate(`globalThis.__outside.pick(${JSON.stringify(label)})`),
    /** The folder the next file picker answers with, as if the person chose it. */
    pickNext: async (path) => {
      await ensure();
      return evaluate(`globalThis.__outside.dialogAnswers.push(${JSON.stringify(path)})`);
    },
  };
}

/** One event, said the way the person at the computer would see it. */
export function describeOutside(event) {
  switch (event.kind) {
    case "browser": {
      let where = event.detail;
      try {
        const url = new URL(event.detail);
        if (url.protocol === "x-apple.systempreferences:") {
          return "System Settings came to the front, open to its Privacy & Security page. This test can't show System Settings, so you can't do anything there.";
        }
        if (url.protocol === "mailto:") {
          return `Your email app came to the front with a new message to ${url.pathname}. This test can't show it.`;
        }
        where = `${url.host}${url.pathname}`;
      } catch {
        // Said as it came.
      }
      return `Your web browser came to the front and opened a page at ${where}. This test can't show you the browser, so you can't do anything there.`;
    }
    case "file-picker":
      return `The Mac's file picker opened${event.detail.title ? ` ("${event.detail.title}")` : ""}${event.detail.message ? `, saying "${event.detail.message}"` : ""}. This test can't show it, so it was closed with Cancel.`;
    case "message-box":
      return `A system alert came up: "${event.detail.message ?? ""}"${event.detail.detail ? ` ${event.detail.detail}` : ""} Buttons: ${(event.detail.buttons ?? ["OK"]).join(", ")}. This test can't show it, so it was dismissed.`;
    case "menu":
      return `A menu popped up at the pointer with these items: ${event.detail.map((item) => (item.enabled ? item.label : `${item.label} (grayed out)`)).join(" | ")}. This test can't draw it; choose one with pick_menu_item, or carry on to dismiss it.`;
    case "notification":
      return `A notification from Instrument slid in at the top right of your screen: "${event.detail.title ?? ""}" ${event.detail.body ? `"${event.detail.body}"` : ""}. You clicked it.`;
    case "page-file-chooser":
      return "The Mac's file picker opened so you could choose a file for the web page. This test can't show it, so it was closed with Cancel.";
    case "page-alert":
      return `The web page put up an alert: "${event.detail}". This test can't show it, so it was dismissed.`;
    case "page-print":
      return "The Mac's print window opened for the web page. This test can't show it, so it was closed with Cancel.";
    case "open-file":
      return `The app asked the Mac to open ${event.detail} in its default app. This test can't show that.`;
    case "show-in-finder":
      return `Finder came to the front showing ${event.detail}. This test can't show Finder.`;
    default:
      return `Something opened outside the app (${event.kind}).`;
  }
}
