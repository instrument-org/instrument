// Drive the running Studio dev app over CDP.
//
// Talks to the debug port directly rather than through the chrome-devtools CLI
// daemon: no socket to go stale when the app restarts, no page ids to be
// invalidated by a reconnect, and a screenshot clip that crops server-side so
// nothing has to redo the device-pixel math. The CLI covers the input side
// perfectly well (it has press_key and type_text); this is about owning the
// lifecycle, not about what it can dispatch.
//
//   node studio-drive.mjs boot          # start an instance this session owns
//   node studio-drive.mjs state
//   node studio-drive.mjs goto /release-notes
//   node studio-drive.mjs click --text "All file types"
//   node studio-drive.mjs press ?
//   node studio-drive.mjs shot out.png --selector '[role=dialog]'
//   node studio-drive.mjs wait 'document.querySelectorAll("webview").length > 0'
//   node studio-drive.mjs stop
//
// Route/modal commands go through `window.__studioDrive`, the dev-only handle
// the renderer attaches (client/lib/studio-drive.ts). Everything else is CDP.
//
// `boot` starts an instance on a port derived from this checkout's path, and
// every other command reads the record it writes. Two things it deliberately
// does not do:
//
// - Fall back to the conventional 48160. That one is almost always a window a
//   person is using: driving it means their clicks fight yours, their quit ends
//   your run, and your navigation moves the app out from under them.
// - Scan for whatever port happens to be free. Two checkouts booting at once
//   can both see the same port free and both spawn; the one that loses the bind
//   would then connect to the winner's window and drive the wrong app. A port
//   per checkout means they never contend in the first place.
//
// Pass `--port` to target a specific instance on purpose.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMANDS = new Set([
  "boot",
  "click",
  "eval",
  "goto",
  "modal",
  "press",
  "shot",
  "state",
  "stop",
  "wait",
]);
const CONVENTIONAL_PORT = 48_160;
const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const STUDIO_DIR = path.join(REPO_ROOT, "apps/studio");

// Keyed by checkout so two worktrees driving at once do not read each other's
// instance, and kept out of the repo so it never shows up in a diff.
const SESSION_FILE = path.join(
  tmpdir(),
  "instrument-studio-drive",
  `${createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 16)}.json`,
);

async function connect(origin) {
  const target = await pickTarget(origin);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(message.error.message));
    } else {
      entry.resolve(message.result);
    }
  });

  const send = (method, parameters = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve });
      socket.send(JSON.stringify({ id, method, params: parameters }));
    });
  };

  return {
    close: () => {
      socket.close();
    },
    send,
  };
}

async function drive(cdp, call) {
  await waitForDriveHandle(cdp);
  return evaluate(cdp, `window.__studioDrive.${call}`);
}

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(cdp, expression) {
  const { exceptionDetails, result } = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description ?? exceptionDetails.text,
    );
  }
  return result.value;
}

async function isPortLive(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// --- CDP ---------------------------------------------------------------

async function pickTarget(origin) {
  let list;
  try {
    const response = await fetch(`${origin}/json/list`);
    list = await response.json();
  } catch {
    fail(`No debug endpoint on ${origin}. Run \`studio-drive.mjs boot\`.`);
  }
  // The main window is one web contents holding the chrome and every tab.
  const page = list.find(
    (t) => t.type === "page" && t.url.includes("/renderer/"),
  );
  if (!page) {
    fail(
      `No Studio renderer among ${list.length} target(s). Is the window open?`,
    );
  }
  return page;
}

function readSession() {
  if (!existsSync(SESSION_FILE)) {
    return;
  }
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return;
  }
}

/**
 * Only an explicit `--port` or this checkout's own booted instance. Notably not
 * `REMOTE_DEBUGGING_PORT` from the environment: an inherited value is most
 * likely pointing at whatever someone else already had running, which is the
 * case this is meant to prevent.
 */
async function resolvePort(explicit) {
  if (explicit) {
    return Number(explicit);
  }

  const session = readSession();
  if (session && (await isPortLive(session.port))) {
    return session.port;
  }

  const hint = (await isPortLive(CONVENTIONAL_PORT))
    ? `Something is answering on ${CONVENTIONAL_PORT}, but that is the conventional port and is probably a window someone is using. ` +
      `Pass --port ${CONVENTIONAL_PORT} if you mean to drive it anyway.`
    : `Nothing is running for this checkout.`;
  fail(
    `${hint}\nRun \`studio-drive.mjs boot\` to start an instance of your own.`,
  );
}

/**
 * The debug port answers as soon as the web contents exists, which is before
 * the renderer has run its entry module, so a command issued right after boot
 * arrives before the handle is attached. Wait for it rather than reporting the
 * race as a missing dev build.
 */
async function waitForDriveHandle(cdp) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (await evaluate(cdp, "Boolean(window.__studioDrive)")) {
      return;
    }
    if (Date.now() > deadline) {
      fail(
        "window.__studioDrive never appeared. Expected on the main window of a dev build " +
          "(client/lib/studio-drive.ts); a packaged build drops it.",
      );
    }
    await sleep(250);
  }
}

function writeSession(session) {
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(session, undefined, 2));
}

// --- element lookup ----------------------------------------------------

/**
 * Resolve an element to its CSS-pixel rect. Text matching is restricted to
 * elements that actually render: names appear more than once in this DOM, and
 * the extra copies measure zero, so an unfiltered match silently targets one of
 * those.
 */
const RECT_FOR = (kind, needle) => `(() => {
  const needle = ${JSON.stringify(needle)};
  let el = null;
  if (${JSON.stringify(kind)} === "selector") {
    el = document.querySelector(needle);
  } else {
    const visible = (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const named = Array.from(document.querySelectorAll("button, a, [role=button], [role=menuitem], [role=tab]"))
      .filter((n) => visible(n) && ((n.getAttribute("aria-label") ?? "") === needle || (n.innerText ?? "").trim() === needle));
    el = named[0] ?? Array.from(document.querySelectorAll("*"))
      .filter((n) => n.children.length === 0 && (n.textContent ?? "").trim() === needle && visible(n))
      .map((n) => n.closest("button, a, [role=button], [role=menuitem], [role=tab]") ?? n)[0] ?? null;
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { height: r.height, width: r.width, x: r.x, y: r.y };
})()`;

/**
 * A port derived from the checkout path, so every worktree owns a different one
 * and two of them never contend. Deterministic on purpose: a scan would hand
 * out whatever happens to be free at that instant, which is how a run ends up
 * on another checkout's window.
 */
function checkoutPort() {
  const digest = createHash("sha256").update(REPO_ROOT).digest();
  return CONVENTIONAL_PORT + 1 + (digest.readUInt16BE(0) % 200);
}

// --- lifecycle ---------------------------------------------------------

async function cmdBoot(explicitPort) {
  const existing = readSession();
  if (existing && (await isPortLive(existing.port))) {
    return { ...existing, reused: true };
  }

  const port = explicitPort ? Number(explicitPort) : checkoutPort();
  // Refuse rather than scanning for the next free port. Scanning is what makes
  // this dangerous: two checkouts booting at once can both see a port free,
  // both spawn, and the one that loses the bind then connects to the winner's
  // window and drives the wrong app believing it is its own.
  if (await isPortLive(port)) {
    fail(
      `Port ${port} belongs to this checkout but something is already on it.\n` +
        `Stop it (\`studio-drive.mjs stop\`, or quit that window) or pass --port to target it deliberately.`,
    );
  }

  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  const logFile = SESSION_FILE.replace(/\.json$/, ".log");
  const log = openSync(logFile, "a");

  const child = spawn("pnpm", ["dev"], {
    cwd: STUDIO_DIR,
    detached: true,
    env: {
      ...process.env,
      // Set by some editor integrations; leaving it on makes Electron run as
      // plain Node and exit without ever opening a window.
      ELECTRON_RUN_AS_NODE: undefined,
      REMOTE_DEBUGGING_PORT: String(port),
    },
    stdio: ["ignore", log, log],
  });
  child.unref();

  const session = {
    logFile,
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  writeSession(session);

  // Ready means the renderer has attached its handle, not that the port
  // answers: the debug endpoint is up well before the app can be driven.
  const deadline = Date.now() + 180_000;
  for (;;) {
    // If the process we started is gone, whatever answers on this port is not
    // ours -- most likely we lost the bind and something else took it.
    if (!isAlive(child.pid)) {
      fail(`Studio exited during startup. See ${logFile}`);
    }
    if (await isPortLive(port)) {
      try {
        const cdp = await connect(`http://127.0.0.1:${port}`);
        try {
          await waitForDriveHandle(cdp);
          return { ...session, reused: false };
        } finally {
          cdp.close();
        }
      } catch {
        // Renderer not serving a target yet; keep waiting.
      }
    }
    if (Date.now() > deadline) {
      fail(`Studio did not become drivable within 180s. See ${logFile}`);
    }
    await sleep(2000);
  }
}

/**
 * Real mouse input rather than `element.click()`, which reaches a plain button
 * but not a handler mounted on an ancestor -- and returns as if it worked.
 */
async function cmdClick(cdp, kind, needle) {
  const rect = await rectFor(cdp, kind, needle);
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type,
      x,
      y,
    });
  }
  await settle(cdp);
  return { clicked: needle, x, y };
}

async function cmdGoto(cdp, path, newTab) {
  await drive(
    cdp,
    `goto(${JSON.stringify(path)}, ${JSON.stringify({ newTab })})`,
  );
  await settle(cdp);
  return drive(cdp, "state()");
}

// --- commands ----------------------------------------------------------

async function cmdModal(cdp, name) {
  await (name === "--close"
    ? drive(cdp, "closeModal()")
    : drive(cdp, `openModal(${JSON.stringify(name)})`));
  await settle(cdp);
  return drive(cdp, "state()");
}

async function cmdState(cdp) {
  return drive(cdp, "state()");
}

function cmdStop() {
  const session = readSession();
  if (!session) {
    return { stopped: false };
  }
  try {
    // The dev server is the process group leader; the Electron app is its child.
    process.kill(-session.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  rmSync(SESSION_FILE, { force: true });
  return { port: session.port, stopped: true };
}

function isAlive(pid) {
  try {
    // Signal 0 tests for the process without touching it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function rectFor(cdp, kind, needle) {
  const rect = await evaluate(cdp, RECT_FOR(kind, needle));
  if (!rect) {
    fail(`No visible element for ${kind} ${JSON.stringify(needle)}`);
  }
  return rect;
}

const KEYS = {
  Enter: { code: "Enter", key: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", key: "Escape", keyCode: 27 },
  Tab: { code: "Tab", key: "Tab", keyCode: 9, text: "\t" },
};

/**
 * A capture taken while the renderer is between loads is a well-formed PNG of
 * an empty page, and nothing in the response says so. HMR reloads the renderer
 * on any file change in the checkout, so a scripted run hits this by being
 * unlucky about timing rather than by doing anything wrong. Check that
 * something is actually mounted first, and say which condition failed.
 */
async function assertRenderable(cdp) {
  const status = await evaluate(
    cdp,
    `(() => {
      const root = document.querySelector('[data-testid="app-page"]') ?? document.querySelector("#root");
      const rect = root?.getBoundingClientRect();
      return {
        hidden: document.visibilityState !== "visible",
        empty: !root || !rect || rect.width === 0 || rect.height === 0,
        blank: (document.body.innerText ?? "").trim().length === 0,
      };
    })()`,
  );
  if (status.hidden) {
    fail("The window is hidden; a capture would be blank.");
  }
  if (status.empty || status.blank) {
    fail(
      "Nothing is mounted yet (mid-reload?). Re-run, or `wait` on something the page should show.",
    );
  }
}

async function cmdPress(cdp, key) {
  const descriptor = KEYS[key] ?? {
    key,
    text: key.length === 1 ? key : undefined,
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...descriptor });
  if (descriptor.text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", ...descriptor });
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...descriptor });
  await settle(cdp);
  return { pressed: key };
}

/**
 * Cropping happens browser-side: `clip` is measured in CSS pixels and the
 * capture already applies the device scale factor, so `scale` stays 1 and the
 * file comes out at native resolution. That is the whole reason to crop here
 * rather than after the fact -- converting a screenshot's device pixels back to
 * the CSS pixels a rect is measured in is where this usually goes wrong.
 *
 * `clip` is only honoured on the surface path, which is why that mode is used
 * even though an occluded window can return a uniform frame through it. That is
 * what {@link assertRenderable} covers.
 */
async function cmdShot(cdp, file, { pad, selector, text }) {
  await assertRenderable(cdp);

  const parameters = {
    captureBeyondViewport: true,
    format: "png",
    fromSurface: true,
  };

  if (selector || text) {
    const rect = await rectFor(
      cdp,
      selector ? "selector" : "text",
      selector ?? text,
    );
    parameters.clip = {
      height: rect.height + pad * 2,
      scale: 1,
      width: rect.width + pad * 2,
      x: Math.max(0, rect.x - pad),
      y: Math.max(0, rect.y - pad),
    };
  }

  const { data } = await cdp.send("Page.captureScreenshot", parameters);
  const png = Buffer.from(data, "base64");
  writeFileSync(file, png);

  return {
    // Straight out of the PNG header, so a clip that silently did not apply
    // shows up as full-window dimensions instead of looking like a success.
    dimensions: `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,
    file,
  };
}

async function cmdWait(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await evaluate(cdp, `Boolean(${expression})`)) {
      return { waited: expression };
    }
    if (Date.now() > deadline) {
      fail(`Timed out after ${timeoutMs}ms waiting for: ${expression}`);
    }
    await sleep(250);
  }
}

// --- plumbing ----------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An expected, already-explained failure: reported without a stack trace. */
class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function flag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function report(result) {
  console.log(JSON.stringify(result, undefined, 2));
}

/** Let React commit and the route settle before the next read. */
async function settle(cdp) {
  await sleep(150);
  await evaluate(
    cdp,
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
  );
}

const [command, ...argv] = process.argv.slice(2);
const positional = argv.filter(
  (a, index) =>
    !a.startsWith("--") && !(index > 0 && argv[index - 1].startsWith("--")),
);

try {
  // Checked before anything talks to an instance, so a typo says so rather than
  // reporting that nothing is running.
  if (!COMMANDS.has(command)) {
    fail(
      `Unknown command ${JSON.stringify(command)}.\n` +
        `Commands: ${[...COMMANDS].join(", ")}`,
    );
  }
  // Lifecycle commands manage the instance rather than talk to one.
  if (command === "boot") {
    report(await cmdBoot(flag(argv, "--port")));
  } else if (command === "stop") {
    report(cmdStop());
  } else {
    report(await runAgainstInstance());
  }
} catch (error) {
  console.error(`studio-drive: ${error.message}`);
  if (!(error instanceof CliError)) {
    console.error(error.stack);
  }
  process.exitCode = 1;
}

async function dispatch(cdp) {
  let result;
  switch (command) {
    case "click": {
      result = await cmdClick(
        cdp,
        flag(argv, "--selector") ? "selector" : "text",
        flag(argv, "--selector") ?? flag(argv, "--text") ?? positional[0],
      );
      break;
    }
    case "eval": {
      result = await evaluate(cdp, positional.join(" "));
      break;
    }
    case "goto": {
      result = await cmdGoto(cdp, positional[0], argv.includes("--new-tab"));
      break;
    }
    case "modal": {
      result = await cmdModal(cdp, argv[0]);
      break;
    }
    case "press": {
      result = await cmdPress(cdp, positional[0]);
      break;
    }
    case "shot": {
      result = await cmdShot(cdp, positional[0], {
        pad: Number(flag(argv, "--pad", "0")),
        selector: flag(argv, "--selector"),
        text: flag(argv, "--text"),
      });
      break;
    }
    case "state": {
      result = await cmdState(cdp);
      break;
    }
    case "wait": {
      result = await cmdWait(
        cdp,
        positional.join(" "),
        Number(flag(argv, "--timeout", "15000")),
      );
      break;
    }
  }
  return result;
}

async function runAgainstInstance() {
  const cdp = await connect(
    `http://127.0.0.1:${await resolvePort(flag(argv, "--port"))}`,
  );
  try {
    return await dispatch(cdp);
  } finally {
    cdp.close();
  }
}
