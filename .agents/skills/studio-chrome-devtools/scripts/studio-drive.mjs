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
//
// `--workspace <fixture>` boots against a disposable workspace built from a
// committed fixture (fixtures/workspaces/) instead of the shared dev
// application-data directory, so a run does not depend on what the developer
// happened to do last. Add `--fresh` to rebuild it first. The flag belongs on
// every command of that run, not just `boot`: it selects both the port and the
// instance record, so two workspaces from one checkout never collide.
//
//   node studio-drive.mjs boot --workspace documents
//   node studio-drive.mjs shot task.png --workspace documents

// `dir` is how a path is named throughout this repo, from `taskDir` through
// `workspaceConfig.tasksDir` to the `ELECTRON_USER_DATA_DIR` this script sets.
// Whole-file because `perfectionist/sort-modules` orders the declarations, so
// any narrower scope stops covering what it was written for.
/* eslint-disable unicorn/prevent-abbreviations */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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

/**
 * The checkout to drive is the one the caller is standing in, not the one this
 * file happens to live in. Those differ whenever a worktree predates the commit
 * that added this script and someone runs it by absolute path from elsewhere,
 * and resolving it the other way round fails in the worst possible manner: it
 * boots the *other* checkout's app, on that checkout's port, and every
 * observation after that is confidently about the wrong code.
 *
 * `git rev-parse --show-toplevel` answers this correctly inside a worktree,
 * which is exactly the case that goes wrong. Falling back to this file's own
 * location keeps it working when run from outside any checkout.
 */
function resolveRepoRoot() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top && existsSync(path.join(top, "apps/studio"))) {
      return top;
    }
  } catch {
    // Not in a checkout, or no git. Fall through.
  }
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

const REPO_ROOT = resolveRepoRoot();
const STUDIO_DIR = path.join(REPO_ROOT, "apps/studio");
const CHECKOUT_KEY = createHash("sha256")
  .update(REPO_ROOT)
  .digest("hex")
  .slice(0, 16);

// A seeded workspace is rebuilt from its fixture in seconds, so it is cache and
// not data: never in the repo, and never in the shared application-data
// directory where it would mix with someone's real tasks.
//
// This is a standalone CLI rather than a turbo task, so the cache-location
// variables below are not something turbo should invalidate on.
/* eslint-disable turbo/no-undeclared-env-vars */
const WORKSPACE_CACHE_ROOT = path.join(
  process.env.LOCALAPPDATA ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Caches")
      : (process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"))),
  "instrument-studio-drive",
  CHECKOUT_KEY,
);
/* eslint-enable turbo/no-undeclared-env-vars */

// Workspaces nobody has driven in this long are dropped at the next boot,
// because nobody runs a clean command. Losing one costs a reseed.
const WORKSPACE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// Installed dependencies inside a task are the only part that grows -- to
// hundreds of megabytes once an agent has run an install in one -- and the only
// part deleting does not invalidate. So they go sooner than the workspace does.
const WORK_ARTIFACT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const WORK_ARTIFACT_NAMES = new Set([".venv", "node_modules"]);

/**
 * Keyed by checkout so two worktrees driving at once do not read each other's
 * instance, and by workspace so a fixture run and a plain dev run are separate
 * instances rather than one overwriting the other's record. Kept out of the repo
 * so it never shows up in a diff.
 */
function sessionFile(workspace) {
  const key = workspace ? `${CHECKOUT_KEY}-${workspace}` : CHECKOUT_KEY;
  return path.join(tmpdir(), "instrument-studio-drive", `${key}.json`);
}

// Read off the raw argv rather than the parsed tail: which instance a command
// talks to has to be settled before anything reads a session record.
const WORKSPACE = flag(process.argv, "--workspace");
const SESSION_FILE = sessionFile(WORKSPACE);

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

/**
 * Evaluate an expression in the page and return its JSON value.
 *
 * Accepts the anonymous `function () { ... }` form too, because the
 * chrome-devtools CLI's `evaluate_script` next door requires exactly that and
 * the habit carries over. On its own that source is a function *statement*
 * missing a name, so it fails to parse with an error that says nothing about
 * the mismatch.
 */
async function evaluate(cdp, source) {
  const trimmed = String(source).trim();
  const expression = /^(?:async\s+)?function\s*\(/.test(trimmed)
    ? `(${trimmed})()`
    : trimmed;

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

  const target = WORKSPACE ? `workspace "${WORKSPACE}"` : "this checkout";
  const hint = (await isPortLive(CONVENTIONAL_PORT))
    ? `Something is answering on ${CONVENTIONAL_PORT}, but that is the conventional port and is probably a window someone is using. ` +
      `Pass --port ${CONVENTIONAL_PORT} if you mean to drive it anyway.`
    : `Nothing is running for ${target}.`;
  fail(
    `${hint}\nRun \`studio-drive.mjs boot${WORKSPACE ? ` --workspace ${WORKSPACE}` : ""}\` to start an instance of your own.`,
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
 * A port derived from the checkout path and the workspace, so every worktree
 * owns a different one, two of them never contend, and one checkout can hold a
 * fixture run and a plain dev run at once. Deterministic on purpose: a scan
 * would hand out whatever happens to be free at that instant, which is how a run
 * ends up on another checkout's window.
 */
function checkoutPort(workspace) {
  const digest = createHash("sha256")
    .update(workspace ? `${REPO_ROOT}#${workspace}` : REPO_ROOT)
    .digest();
  return CONVENTIONAL_PORT + 1 + (digest.readUInt16BE(0) % 200);
}

async function cmdBoot(explicitPort, { fresh }) {
  const existing = readSession();
  if (existing && (await isPortLive(existing.port))) {
    if (fresh) {
      fail(
        `--fresh rebuilds the workspace on disk and the instance on port ${existing.port} has it open.\n` +
          `Run \`studio-drive.mjs stop${WORKSPACE ? ` --workspace ${WORKSPACE}` : ""}\` first.`,
      );
    }
    return { ...existing, reused: true };
  }

  const workspace = WORKSPACE
    ? prepareWorkspace(WORKSPACE, { fresh })
    : undefined;

  const port = explicitPort ? Number(explicitPort) : checkoutPort(WORKSPACE);
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
      // A seeded workspace has no provider credentials and must not: they
      // cannot be committed. Without this the app opens the onboarding window
      // and never reveals the main one, which reads as a hang.
      ...(workspace && {
        ELECTRON_USER_DATA_DIR: workspace.userDataDir,
        SKIP_ONBOARDING: "true",
      }),
    },
    stdio: ["ignore", log, log],
  });
  child.unref();

  const session = {
    logFile,
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    ...(workspace && { tasks: workspace.tasks, workspace: WORKSPACE }),
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

// --- lifecycle ---------------------------------------------------------

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

// --- commands ----------------------------------------------------------

function isAlive(pid) {
  try {
    // Signal 0 tests for the process without touching it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build (or reuse) the workspace this boot will run against, and hand back the
 * directory to point `ELECTRON_USER_DATA_DIR` at. The seeder is idempotent and
 * fast, so calling it on every boot is cheaper than reasoning about whether the
 * fixture has changed since last time.
 */
function prepareWorkspace(name, { fresh }) {
  reapStaleWorkspaces();

  const userDataDir = path.join(WORKSPACE_CACHE_ROOT, name);
  mkdirSync(WORKSPACE_CACHE_ROOT, { recursive: true });

  let output;
  try {
    output = execFileSync(
      "pnpm",
      [
        "workspace:seed",
        "--out",
        userDataDir,
        "--fixture",
        name,
        ...(fresh ? ["--fresh"] : []),
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  } catch {
    fail(`Could not seed workspace "${name}". See the seeder output above.`);
  }

  // The seeder prints its summary last; pnpm's own banner precedes it.
  const start = output.indexOf("{");
  if (start === -1) {
    fail(`The seeder printed no summary for "${name}":\n${output}`);
  }
  const result = JSON.parse(output.slice(start));

  // Reaping goes by mtime, so record that this workspace was used even when the
  // seeder had nothing to do and the app writes nothing before it is killed.
  utimesSync(userDataDir, new Date(), new Date());

  reapWorkArtifacts(path.join(userDataDir, "workspace", "tasks"));

  return { tasks: result.tasks, userDataDir };
}

function reapStaleWorkspaces() {
  let entries;
  try {
    entries = readdirSync(WORKSPACE_CACHE_ROOT, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(WORKSPACE_CACHE_ROOT, entry.name);
    if (Date.now() - statSync(dir).mtimeMs > WORKSPACE_MAX_AGE_MS) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
}

/**
 * Drops installed dependencies left inside tasks by a live agent run. A replay
 * never creates these, so a workspace only used for driving stays in the low
 * megabytes and this finds nothing.
 */
function reapWorkArtifacts(tasksDir) {
  let tasks;
  try {
    tasks = readdirSync(tasksDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const task of tasks) {
    if (!task.isDirectory()) {
      continue;
    }
    for (const name of WORK_ARTIFACT_NAMES) {
      const dir = path.join(tasksDir, task.name, "work", name);
      try {
        if (Date.now() - statSync(dir).mtimeMs > WORK_ARTIFACT_MAX_AGE_MS) {
          rmSync(dir, { force: true, recursive: true });
        }
      } catch {
        // Not there, which is the normal case.
      }
    }
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
    report(
      await cmdBoot(flag(argv, "--port"), { fresh: argv.includes("--fresh") }),
    );
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

/* eslint-enable unicorn/prevent-abbreviations */
