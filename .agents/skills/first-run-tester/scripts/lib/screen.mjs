// The tester's eyes and hands: pixels of the app's window out, pointer and
// keyboard in, over the Chrome DevTools Protocol. Nothing here reads the DOM
// or the accessibility tree, and nothing it returns names an element.
//
// Zero dependencies (Node 24: global WebSocket and fetch).

import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One CDP connection to a websocket debugger URL. */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  // A process that is starting or going away can accept the connection and
  // never finish the handshake, so the wait for it is bounded.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP at ${wsUrl} did not answer`));
    }, 5000);
    ws.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
    ws.addEventListener(
      "error",
      () => (clearTimeout(timer), reject(new Error(`no CDP at ${wsUrl}`))),
      { once: true },
    );
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  let closed = false;
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) {
      listeners.get(message.method)?.(message.params);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message));
    } else {
      waiter.resolve(message.result);
    }
  });
  ws.addEventListener("close", () => {
    closed = true;
    for (const waiter of pending.values()) {
      waiter.reject(new Error("CDP connection closed"));
    }
    pending.clear();
  });
  return {
    close: () => ws.close(),
    get closed() {
      return closed;
    },
    on: (method, handler) => listeners.set(method, handler),
    send(method, params = {}, timeoutMs = 15_000) {
      if (closed || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("CDP connection closed"));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
          reject: (error) => (clearTimeout(timer), reject(error)),
          resolve: (value) => (clearTimeout(timer), resolve(value)),
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    wsUrl,
  };
}

/**
 * The app's windows, as the debug endpoint lists them (newest first). The app
 * can restart itself, and between windows there is a moment with none, so
 * this waits for one, for `withinMs` at most.
 */
async function windows(port, withinMs = 20_000) {
  let last = new Error("The app has no window open.");
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      const targets = await response.json();
      // Only the app's own windows (setup's and the app's, both served from
      // /renderer/). The app also keeps helper pages nobody sees, such as the
      // blank one it draws a file's thumbnail in, and those are listed first
      // while they live.
      const pages = targets.filter(
        (target) => target.type === "page" && target.url.includes("/renderer/"),
      );
      if (pages.length > 0) {
        return pages;
      }
    } catch (error) {
      last = error;
    }
    await sleep(500);
  }
  throw last;
}

const KEYS = {
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  ArrowUp: 38,
  Backspace: 8,
  Delete: 46,
  End: 35,
  Enter: 13,
  Escape: 27,
  Home: 36,
  PageDown: 34,
  PageUp: 33,
  Space: 32,
  Tab: 9,
};
const MODIFIERS = { Alt: 1, Cmd: 4, Control: 2, Ctrl: 2, Meta: 4, Option: 1, Shift: 8 };

/**
 * A screen over the app instance on `port`. It follows whichever window is
 * newest, the way a person looks at the window that just came up: setup's
 * window first, the app's once setup closes.
 */
export function openScreen({ port }) {
  let cdp;
  let pointer = { x: 0, y: 0 };
  let zoom = 1;

  // One connection per window of the app, each told to hand over what would
  // otherwise come up as a system window: a file chooser (an
  // <input type="file"> opens the Mac's own panel, on the real screen) and a
  // JavaScript alert. Both are recorded and dismissed instead. Pages embedded
  // in a window get the same from the main process (outside.mjs), with no
  // debugger of the harness's on them.
  //
  // No connection is trusted from one tool call to the next: the app can
  // restart itself between them, and a connection to a process that went
  // away does not always say so. `refresh` drops every one and connects
  // again, and each call starts with it. They stay open between calls only
  // so a chooser or an alert that comes up meanwhile is still caught.
  let guarded = new Map();
  let newestId;
  const notes = [];

  async function guard(target) {
    const connection = await connect(target.webSocketDebuggerUrl);
    connection.on("Page.fileChooserOpened", () => {
      notes.push({ kind: "file-chooser" });
    });
    connection.on("Page.javascriptDialogOpening", (params) => {
      notes.push({ kind: "alert", message: params.message, type: params.type });
      connection
        .send("Page.handleJavaScriptDialog", { accept: params.type === "alert" })
        .catch(() => {});
    });
    await connection.send("Page.enable", {}, 5000);
    await connection.send("Page.setInterceptFileChooserDialog", { enabled: true }, 5000);
    return connection;
  }

  /**
   * Fresh connections to each of the app's windows. The screen is the one
   * the app's own capture last drew (`screenOf`, the mark it leaves in that
   * window's page), or the newest when nothing says.
   */
  async function refresh(withinMs, screenOf) {
    const list = await windows(port, withinMs);
    const fresh = new Map();
    for (const target of list) {
      try {
        fresh.set(target.id, await guard(target));
      } catch {
        // A window that closed between the list and the connection.
      }
    }
    for (const connection of guarded.values()) {
      connection.close();
    }
    guarded = fresh;
    newestId = list[0].id;
    if (screenOf !== undefined) {
      for (const [id, connection] of guarded) {
        try {
          const { result } = await connection.send(
            "Runtime.evaluate",
            { expression: "globalThis.__screenOf", returnByValue: true },
            3000,
          );
          if (result.value === screenOf) {
            newestId = id;
          }
        } catch {
          // Not this one.
        }
      }
    }
    cdp = guarded.get(newestId);
    if (!cdp) {
      throw new Error("The app's window is not answering.");
    }
    return { count: list.length };
  }

  /** The connection to the screen, made if this is the first use or it has gone. */
  async function page() {
    if (!cdp || cdp.closed) {
      await refresh();
    }
    return { cdp, count: 1 };
  }

  /** PNG of the window, one image pixel per pointer unit. */
  async function capture(file, { cropBottom = 0 } = {}) {
    const { cdp, count } = await page();
    const { cssVisualViewport: view } = await cdp.send("Page.getLayoutMetrics");
    const width = Math.round(view.clientWidth);
    const height = Math.round(view.clientHeight) - cropBottom;
    const shoot = async (scale) => {
      const { data } = await cdp.send("Page.captureScreenshot", {
        captureBeyondViewport: false,
        clip: { height, scale, width, x: 0, y: 0 },
        format: "png",
      });
      return Buffer.from(data, "base64");
    };
    let png = await shoot(1);
    // A capture comes back at the display's scale (2x on a Retina Mac). Its
    // real width is in the PNG header; shot again scaled down, a point in the
    // image is the same point the pointer takes.
    const actual = png.readUInt32BE(16);
    if (actual !== width) {
      png = await shoot(width / actual);
    }
    if (file) {
      writeFileSync(file, png);
    }
    return {
      height,
      pixels: { height: png.readUInt32BE(20), width: png.readUInt32BE(16) },
      png,
      width,
      windowCount: count,
    };
  }

  async function mouse(type, x, y, extra = {}) {
    const { cdp } = await page();
    await cdp.send("Input.dispatchMouseEvent", {
      button: "none",
      pointerType: "mouse",
      type,
      x: x / zoom,
      y: y / zoom,
      ...extra,
    });
    pointer = { x, y };
  }

  async function move(x, y) {
    // A few steps, so hover states and drag thresholds see a moving pointer.
    const from = pointer;
    for (let step = 1; step <= 4; step++) {
      await mouse(
        "mouseMoved",
        Math.round(from.x + ((x - from.x) * step) / 4),
        Math.round(from.y + ((y - from.y) * step) / 4),
      );
    }
  }

  async function click(x, y, { button = "left", count = 1 } = {}) {
    await move(x, y);
    for (let n = 1; n <= count; n++) {
      await mouse("mousePressed", x, y, { button, buttons: 1, clickCount: n });
      await mouse("mouseReleased", x, y, { button, clickCount: n });
    }
  }

  async function drag(fromX, fromY, toX, toY) {
    await move(fromX, fromY);
    await mouse("mousePressed", fromX, fromY, {
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 8; step++) {
      await mouse(
        "mouseMoved",
        Math.round(fromX + ((toX - fromX) * step) / 8),
        Math.round(fromY + ((toY - fromY) * step) / 8),
        { button: "left", buttons: 1 },
      );
      await sleep(20);
    }
    await mouse("mouseReleased", toX, toY, { button: "left", clickCount: 1 });
  }

  async function scroll(x, y, deltaY, deltaX = 0) {
    await move(x, y);
    await mouse("mouseWheel", x, y, { deltaX, deltaY });
  }

  /** Types text a character at a time, the way a keyboard delivers it. */
  async function type(text) {
    const { cdp } = await page();
    for (const char of text) {
      if (char === "\n") {
        await key("Enter");
        continue;
      }
      await cdp.send("Input.dispatchKeyEvent", { text: char, type: "keyDown" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp" });
    }
  }

  /** One key or chord: "Enter", "Escape", "Tab", "Cmd+A", "Shift+Tab", "a". */
  async function key(combo) {
    const { cdp } = await page();
    const parts = combo.split("+");
    const name = parts.pop();
    let modifiers = 0;
    for (const part of parts) {
      if (!(part in MODIFIERS)) {
        throw new Error(`Unknown modifier "${part}" in "${combo}".`);
      }
      modifiers |= MODIFIERS[part];
    }
    let descriptor;
    if (name in KEYS) {
      descriptor = {
        code: name,
        key: name === "Space" ? " " : name,
        windowsVirtualKeyCode: KEYS[name],
        ...(name === "Enter" && { text: "\r" }),
        ...(name === "Space" && { text: " " }),
      };
    } else if (name.length === 1) {
      const upper = name.toUpperCase();
      descriptor = {
        code: /[a-z]/i.test(name) ? `Key${upper}` : undefined,
        key: name,
        windowsVirtualKeyCode: upper.charCodeAt(0),
        // A chord with Cmd or Ctrl is a command, not a character.
        ...((modifiers & 6) === 0 && { text: name }),
      };
    } else {
      throw new Error(
        `Unknown key "${name}". Keys: ${Object.keys(KEYS).join(", ")}, or one character.`,
      );
    }
    await cdp.send("Input.dispatchKeyEvent", {
      modifiers,
      type: descriptor.text ? "keyDown" : "rawKeyDown",
      ...descriptor,
    });
    await cdp.send("Input.dispatchKeyEvent", { modifiers, type: "keyUp", ...descriptor });
  }

  return {
    capture,
    click,
    close: () => {
      for (const connection of guarded.values()) {
        connection.close();
      }
    },
    /** Runs an expression in the screen's own page, for the harness's own arrangements. */
    evaluate: async (expression) => {
      const { cdp: connection } = await page();
      const { exceptionDetails, result } = await connection.send(
        "Runtime.evaluate",
        { awaitPromise: true, expression, returnByValue: true },
        20_000,
      );
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      }
      return result.value;
    },
    refresh,
    /** Loads the screen's page again. */
    reload: async () => {
      const { cdp: connection } = await page();
      await connection.send("Page.reload");
    },
    /** How far the window is zoomed, so a point in its picture finds the same point in its page. */
    setZoom: (factor) => {
      zoom = factor || 1;
    },
    /** Which window the screen is, to notice another taking its place. */
    windowId: () => newestId,
    /** What was kept off the real screen since the last call. */
    takeNotes: () => notes.splice(0),
    drag,
    key,
    move,
    scroll,
    type,
  };
}
