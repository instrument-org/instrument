// The Studio app as a set of primitives to write code against.
//
// `studio-drive.mjs` is one caller of this: a CLI that connects, runs a single
// primitive, and disconnects. The other caller is a script, which connects once
// and composes as many as it likes:
//
//   import { connect } from "./studio-app.mjs";
//
//   const app = await connect();
//   try {
//     await app.click("Skills");
//     await app.waitFor('window.__studioDrive.state().path.startsWith("/skills")');
//     const skills = await app.rpc("workspace.skill.list", {});
//     if (skills.length === 0) await app.click("New skill");
//   } finally {
//     app.close();
//   }
//
// Why that shape matters, measured rather than assumed: a primitive costs 0.3ms
// to 30ms over a held connection, while a command costs about 10s once the model
// round trip to write the next one is counted. Sequences are therefore roughly
// 350x cheaper expressed as code than as a command apiece, and the ones agents
// actually run average under one genuinely unpredictable step per thirteen. The
// point of this module is that the predictable twelve stop costing anything.
//
// Plain functions rather than a step language on purpose. A sequence needs to
// branch on what it found, retry a different way, and loop until something
// settles, and a script already does all three. Anything a caller wants that is
// not here can be reached through `app.eval` or `app.cdp` without waiting for
// this file to grow a verb for it.
//
// Every call appends to `app.trace`, so a run that stops halfway reports what it
// did and where it stopped, rather than leaving the caller to reconstruct it.

/* eslint-disable perfectionist/sort-modules */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONVENTIONAL_PORT = 48_160;
/** How long a command waits on an instance that is mid-relaunch. */
const RESTART_GRACE_MS = 30_000;
const HANDLE_TIMEOUT_MS = 20_000;

/** An expected, already-explained failure: reported without a stack trace. */
export class DriveError extends Error {}

export function fail(message) {
  throw new DriveError(message);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

export const REPO_ROOT = resolveRepoRoot();
export const STUDIO_DIR = path.join(REPO_ROOT, "apps/studio");
export const CHECKOUT_KEY = createHash("sha256")
  .update(REPO_ROOT)
  .digest("hex")
  .slice(0, 16);

/**
 * A port derived from the checkout path and the workspace, so every worktree
 * owns a different one, two of them never contend, and one checkout can hold a
 * fixture run and a plain dev run at once. Deterministic on purpose: a scan
 * would hand out whatever happens to be free at that instant, which is how a run
 * ends up on another checkout's window.
 */
export function checkoutPort(workspace) {
  const digest = createHash("sha256")
    .update(workspace ? `${REPO_ROOT}#${workspace}` : REPO_ROOT)
    .digest();
  return CONVENTIONAL_PORT + 1 + (digest.readUInt16BE(0) % 200);
}

// --- the instance record -----------------------------------------------

/**
 * Keyed by checkout so two worktrees driving at once do not read each other's
 * instance, and by workspace so a fixture run and a plain dev run are separate
 * instances rather than one overwriting the other's record. Kept out of the repo
 * so it never shows up in a diff.
 */
export function sessionFile(workspace) {
  const key = workspace ? `${CHECKOUT_KEY}-${workspace}` : CHECKOUT_KEY;
  return path.join(tmpdir(), "instrument-studio-drive", `${key}.json`);
}

export function readSession(workspace) {
  const file = sessionFile(workspace);
  if (!existsSync(file)) {
    return;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }
}

export function writeSession(workspace, session) {
  const file = sessionFile(workspace);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(session, undefined, 2));
}

export function isAlive(pid) {
  try {
    // Signal 0 tests for the process without touching it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function isPortLive(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Only an explicit port or this checkout's own booted instance. Notably not
 * `REMOTE_DEBUGGING_PORT` from the environment: an inherited value is most
 * likely pointing at whatever someone else already had running, which is the
 * case this is meant to prevent.
 */
export async function resolvePort({ port, workspace } = {}) {
  if (port) {
    return Number(port);
  }

  const session = readSession(workspace);
  if (session && (await isPortLive(session.port))) {
    return session.port;
  }

  // A main-process rebuild relaunches the app: the pid recorded here belongs to
  // the dev server and survives, while the debug port stops answering for a few
  // seconds. That is not "nothing is running", and saying so sends a run off to
  // boot a second instance of what it already has. Wait it out instead, which
  // is also the only alternative to the caller sleeping and retrying by hand.
  if (session && isAlive(session.pid)) {
    console.error(
      `studio-drive: the instance on port ${session.port} is restarting; waiting for it.`,
    );
    const deadline = Date.now() + RESTART_GRACE_MS;
    while (Date.now() < deadline) {
      await sleep(200);
      if (await isPortLive(session.port)) {
        return session.port;
      }
      if (!isAlive(session.pid)) {
        break;
      }
    }
    fail(
      `The instance for this checkout (pid ${session.pid}) stopped answering on port ${session.port} and did not come back.\n` +
        `Its log is ${session.logFile}. Or \`studio-drive.mjs stop\` and boot again.`,
    );
  }

  const target = workspace ? `workspace "${workspace}"` : "this checkout";
  const hint = (await isPortLive(CONVENTIONAL_PORT))
    ? `Something is answering on ${CONVENTIONAL_PORT}, but that is the conventional port and is probably a window someone is using. ` +
      `Pass --port ${CONVENTIONAL_PORT} if you mean to drive it anyway.`
    : `Nothing is running for ${target}.`;
  fail(
    `${hint}\nRun \`studio-drive.mjs boot --purpose <purpose>${workspace ? ` --workspace ${workspace}` : ""}\` to start an instance of your own.`,
  );
}

// --- CDP ----------------------------------------------------------------

async function pickTarget(origin) {
  let list;
  try {
    const response = await fetch(`${origin}/json/list`);
    list = await response.json();
  } catch {
    fail(
      `No debug endpoint on ${origin}. Run \`studio-drive.mjs boot --purpose <purpose>\`.`,
    );
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

/** A raw CDP connection. {@link connect} is what a caller usually wants. */
export async function openCdp(origin) {
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

/**
 * Evaluate an expression in the page and return its JSON value.
 *
 * Accepts the anonymous `function () { ... }` form too, because the
 * chrome-devtools CLI's `evaluate_script` next door requires exactly that and
 * the habit carries over. On its own that source is a function *statement*
 * missing a name, so it fails to parse with an error that says nothing about
 * the mismatch.
 */
export async function evaluate(cdp, source) {
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

async function waitForHandle(cdp, name, absentMessage) {
  const deadline = Date.now() + HANDLE_TIMEOUT_MS;
  for (;;) {
    if (await evaluate(cdp, `Boolean(window.${name})`)) {
      return;
    }
    if (Date.now() > deadline) {
      fail(absentMessage);
    }
    await sleep(50);
  }
}

/**
 * The debug port answers as soon as the web contents exists, which is before
 * the renderer has run its entry module, so a command issued right after boot
 * arrives before the handle is attached. Wait for it rather than reporting the
 * race as a missing dev build.
 */
export const waitForDriveHandle = (cdp) =>
  waitForHandle(
    cdp,
    "__studioDrive",
    "window.__studioDrive never appeared. Expected on the main window of a dev build " +
      "(client/lib/studio-drive.ts); a packaged build drops it.",
  );

/**
 * Same race, against the bridge the renderer entry attaches before it mounts
 * anything. Unlike the drive handle this one also ships in a packaged build, so
 * its absence means the renderer has not run its entry yet rather than that the
 * build dropped it.
 */
export const waitForDebugBridge = (cdp) =>
  waitForHandle(
    cdp,
    "__studioDebug",
    "window.__studioDebug never appeared. The renderer entry attaches it " +
      "(client/lib/debug-rpc-bridge.ts) before it mounts.",
  );

// --- element lookup -----------------------------------------------------

/**
 * Resolve an element to its CSS-pixel rect. Text matching is restricted to
 * elements that actually render: names appear more than once in this DOM, and
 * the extra copies measure zero, so an unfiltered match silently targets one of
 * those.
 */
const RECT_FOR = (kind, needle) => `(() => {
  const needle = ${JSON.stringify(needle)};
  // Rendered at all: enough to pick between the copies of a name, but not
  // enough to click. A row scrolled out of a long list measures non-zero at
  // coordinates outside the viewport.
  const rendered = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const onScreen = (r) =>
    r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;

  // Every role a menu item can carry, not just [role=menuitem]: a checkable row
  // (Radix's CheckboxItem/RadioItem, which is how a menu offers a choice rather
  // than an action) takes one of the other two, and leaving them out made a
  // whole class of menu unclickable by name.
  const CLICKABLE = "button, a, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab]";

  let el = null;
  if (${JSON.stringify(kind)} === "selector") {
    el = document.querySelector(needle);
  } else {
    const named = Array.from(document.querySelectorAll(CLICKABLE))
      .filter((n) => rendered(n) && ((n.getAttribute("aria-label") ?? "") === needle || (n.innerText ?? "").trim() === needle));
    el = named[0] ?? Array.from(document.querySelectorAll("*"))
      .filter((n) => n.children.length === 0 && (n.textContent ?? "").trim() === needle && rendered(n))
      .map((n) => n.closest(CLICKABLE) ?? n)[0] ?? null;
  }
  if (!el) return null;

  // Bring it into view rather than dispatching at a coordinate the window does
  // not cover, which lands on nothing and returns as though it had worked.
  let r = el.getBoundingClientRect();
  let scrolled = false;
  if (!onScreen(r)) {
    el.scrollIntoView({ block: "center", inline: "center" });
    r = el.getBoundingClientRect();
    scrolled = true;
  }
  return {
    height: r.height,
    offScreen: !onScreen(r),
    scrolled,
    width: r.width,
    x: r.x,
    y: r.y,
  };
})()`;

const KEYS = {
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", keyCode: 39 },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", keyCode: 38 },
  Backspace: { code: "Backspace", key: "Backspace", keyCode: 8 },
  Enter: { code: "Enter", key: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", key: "Escape", keyCode: 27 },
  Tab: { code: "Tab", key: "Tab", keyCode: 9, text: "\t" },
};

/** CDP's modifier bitmask. */
const MODIFIER_BITS = {
  alt: 1,
  cmd: 4,
  command: 4,
  control: 2,
  ctrl: 2,
  meta: 4,
  shift: 8,
};
const NON_SHIFT_MODIFIERS = ~MODIFIER_BITS.shift;

/**
 * Normalize the ways a caller names an element. A bare string is text, because
 * that is what a snapshot hands you and what most calls want; an object says
 * which of the two it meant.
 */
function targetOf(target) {
  if (typeof target === "string") {
    return { kind: "text", needle: target };
  }
  if (target?.selector) {
    return { kind: "selector", needle: target.selector };
  }
  if (target?.text) {
    return { kind: "text", needle: target.text };
  }
  fail(
    `Cannot address ${JSON.stringify(target)}. Pass a string, {text}, or {selector}.`,
  );
}

// --- the app ------------------------------------------------------------

const IDLE_POLL_MS = 500;
const WAIT_POLL_MS = 100;

/**
 * Connect to a running instance and return the app to write code against.
 *
 * `allowReload` is off by default and that is deliberate. Any write in the
 * checkout relaunches the app or hot-updates the renderer, which takes the state
 * a sequence navigated to with it, and the result reads as a step that stopped
 * working rather than as a reload. A long sequence is a larger thing to lose
 * that way than a single command is, so the default is to stop at the step where
 * it happened and say so. Pass `{ allowReload: true }` when the sequence is
 * meant to survive one, or is testing one.
 */
export async function connect({ allowReload = false, port, workspace } = {}) {
  const resolved = await resolvePort({ port, workspace });
  const cdp = await openCdp(`http://127.0.0.1:${resolved}`);

  const trace = [];
  const app = {
    /** The raw CDP connection, for anything this module has no verb for. */
    cdp,
    port: resolved,
    /** Every call, in order: what it was, how long it took, how it ended. */
    trace,
    workspace,
  };

  const loadAt = async () =>
    evaluate(cdp, "window.__studioDrive?.load?.() ?? null");
  let load = await loadAt();

  /**
   * Wrap one primitive: time it, record it, and notice a reload landing under
   * it. The reload check is one evaluation of a value the renderer already
   * holds, so it costs a fraction of a millisecond against steps that cost tens.
   */
  const step = async (label, run, summarize) => {
    const startedAt = Date.now();
    const entry = { label, step: trace.length + 1 };
    trace.push(entry);
    try {
      const value = await run();
      entry.ms = Date.now() - startedAt;
      entry.ok = true;
      const summary = summarize ? summarize(value) : value;
      if (summary !== undefined) {
        entry.value = summary;
      }

      const now = await loadAt();
      if (now && load && now.id !== load.id) {
        entry.reloaded = true;
        load = now;
        if (!allowReload) {
          fail(
            `The app reloaded during "${label}". Whatever was navigated to, opened, or ` +
              `typed is gone, so every result after this one would describe the reload ` +
              `rather than the code. Re-establish the state and run again, or pass ` +
              `{ allowReload: true } if the sequence expects it.`,
          );
        }
      } else if (now && load && now.updates > load.updates) {
        entry.hotUpdates = now.updates - load.updates;
        load = now;
      }

      return value;
    } catch (error) {
      entry.ms = Date.now() - startedAt;
      entry.ok = false;
      entry.error = error.message;
      throw error;
    }
  };

  const settle = async () => {
    await sleep(150);
    await evaluate(
      cdp,
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
    );
  };

  const drive = async (call) => {
    await waitForDriveHandle(cdp);
    return evaluate(cdp, `window.__studioDrive.${call}`);
  };

  Object.assign(app, {
    /**
     * Real mouse input rather than `element.click()`, which reaches a plain
     * button but not a handler mounted on an ancestor -- and returns as if it
     * worked.
     */
    click: async (target, label) => {
      const { kind, needle } = targetOf(target);
      return step(label ?? `click ${needle}`, async () => {
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
        await settle();
        // Recorded because it means the page moved under the run: what was on
        // screen before this step is not what is on screen after it.
        return { x, y, ...(rect.scrolled && { scrolledIntoView: true }) };
      });
    },

    close: () => {
      cdp.close();
    },

    // --- reading ------------------------------------------------------

    closeModal: (label = "close modal") =>
      step(label, async () => {
        await drive("closeModal()");
        await settle();
        return drive("state()");
      }),

    /** Evaluate an expression in the page. The escape hatch, not a last resort. */
    eval: (expression, label) =>
      step(label ?? `eval ${preview(expression)}`, () =>
        evaluate(cdp, expression),
      ),

    /**
     * Assert something is true right now, without waiting. The point is that the
     * failure lands on the step that was wrong and carries a message, rather
     * than surfacing three steps later as something unrelated.
     */
    expect: (condition, message) =>
      step(`expect ${message ?? preview(String(condition))}`, async () => {
        const met =
          typeof condition === "string"
            ? await evaluate(cdp, `Boolean(${condition})`)
            : await condition();
        if (!met) {
          fail(
            message
              ? `Expected ${message}`
              : `Expected ${typeof condition === "string" ? condition : "condition"}`,
          );
        }
        return { met: true };
      }),

    goto: (route, { label, newTab = false } = {}) =>
      step(label ?? `goto ${route}`, async () => {
        await drive(
          `goto(${JSON.stringify(route)}, ${JSON.stringify({ newTab })})`,
        );
        await settle();
        return drive("state()");
      }),

    // --- acting -------------------------------------------------------

    openModal: (name, label) =>
      step(label ?? `open ${name}`, async () => {
        await drive(`openModal(${JSON.stringify(name)})`);
        await settle();
        return drive("state()");
      }),

    press: (key, label) =>
      step(label ?? `press ${key}`, async () => {
        await pressKey(cdp, key);
        await settle();
        return { key };
      }),

    /** Whether a reload has landed since this connection opened. */
    reloaded: () => trace.some((entry) => entry.reloaded),

    /**
     * Call an oRPC route through the renderer's real client.
     *
     * Reach for this before the DOM whenever the question is about state rather
     * than about pixels: it answers what the UI painted *from*, and it does not
     * move when a component does.
     */
    rpc: (route, input, label) =>
      step(label ?? `rpc ${route}`, () => callRpc(cdp, route, input)),

    /** Screenshot the window, or one element, cropped browser-side. */
    shot: (file, { label, pad = 0, selector, text } = {}) =>
      step(label ?? `shot ${file}`, () =>
        capture(cdp, file, { pad, selector, text }),
      ),

    /**
     * The accessibility tree as indented `role "name"` lines, in the same terms
     * `click` matches on. The trace keeps the line count; the caller gets the
     * tree, so reading a page does not bloat what a run reports.
     */
    snapshot: ({ depth = 12, label, selector } = {}) =>
      step(
        label ?? `snapshot ${selector ?? "page"}`,
        () => snapshotTree(cdp, { depth, selector }),
        (value) => ({ nodes: value.nodes }),
      ),

    /** Route, tabs, and any open dialog. `path` is authoritative. */
    state: (label = "state") => step(label, () => drive("state()")),

    // --- waiting ------------------------------------------------------

    /** One key event per character, so a controlled input sees real typing. */
    type: (text, label) =>
      step(label ?? `type ${preview(text)}`, async () => {
        for (const character of text) {
          await pressKey(cdp, character);
        }
        await settle();
        return { length: text.length };
      }),

    /**
     * Wait for a condition. A string is evaluated in the page, which is the fast
     * path at a fraction of a millisecond per poll; a function runs here, for
     * conditions that need more than one read to decide.
     *
     * This is what replaces a `sleep`. A sleep long enough to be reliable is
     * always much longer than the thing it is waiting for, and a sleep that is
     * too short fails as though the step were wrong.
     */
    waitFor: (condition, { label, timeout = 15_000 } = {}) =>
      step(
        label ??
          `wait ${typeof condition === "string" ? preview(condition) : "for condition"}`,
        async () => {
          const startedAt = Date.now();
          const deadline = startedAt + timeout;
          for (;;) {
            const met =
              typeof condition === "string"
                ? await evaluate(cdp, `Boolean(${condition})`)
                : await condition();
            if (met) {
              return { waitedMs: Date.now() - startedAt };
            }
            if (Date.now() > deadline) {
              fail(
                `Timed out after ${timeout}ms waiting for: ${
                  typeof condition === "string" ? condition : "condition"
                }`,
              );
            }
            await sleep(WAIT_POLL_MS);
          }
        },
      ),

    /**
     * Wait for a task's agent to stop working, read from the status route rather
     * than from whatever the page is painting. See the note on `sawBusy`: false
     * means the prompt never started an agent, and the idle being reported is
     * the state from before it.
     */
    waitForIdle: ({ label, settleMs = 2000, taskId, timeout = 600_000 }) =>
      step(label ?? `idle ${taskId}`, () =>
        waitIdle(cdp, { settleMs, taskId, timeoutMs: timeout }),
      ),
  });

  return app;
}

// --- primitives the app is built from -----------------------------------

const preview = (text) => {
  const line = String(text).replaceAll(/\s+/g, " ").trim();
  return line.length > 48 ? `${line.slice(0, 45)}...` : line;
};

/**
 * Turn `"Meta+k"` or `"?"` into the event fields Chromium needs.
 *
 * A shortcut carrying a modifier needs its virtual key code: `key` plus a
 * modifier bitmask alone reaches a document-level listener but is ignored by
 * anything reading the accelerator, so the press silently does nothing. Those
 * codes are only filled in where the mapping is unambiguous -- the named keys
 * and the alphanumerics -- because a wrong one is worse than an absent one.
 */
function keyDescriptor(combination) {
  const parts = String(combination).split("+");
  // A trailing `+` is the plus key itself rather than an empty modifier.
  const name = parts.pop() || "+";

  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIER_BITS[part.toLowerCase()];
    if (!bit) {
      fail(
        `Unknown modifier ${JSON.stringify(part)} in ${JSON.stringify(combination)}.\n` +
          `Use alt, control (ctrl), meta (cmd, command), or shift.`,
      );
    }
    modifiers |= bit;
  }

  const known = KEYS[name];
  const alphanumeric = name.length === 1 && /[a-z0-9]/i.test(name);
  const descriptor = known ?? {
    key: name,
    ...(alphanumeric && {
      code: /[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : `Digit${name}`,
      keyCode: name.toUpperCase().codePointAt(0),
    }),
    ...(name.length === 1 && { text: name }),
  };

  return {
    ...descriptor,
    modifiers,
    ...(descriptor.keyCode && {
      nativeVirtualKeyCode: descriptor.keyCode,
      windowsVirtualKeyCode: descriptor.keyCode,
    }),
    // Meta+K must not also insert a "k". Shift is the exception, since Shift+A
    // is how a capital letter is typed.
    ...((modifiers & NON_SHIFT_MODIFIERS) !== 0 && { text: undefined }),
  };
}

async function pressKey(cdp, combination) {
  const descriptor = keyDescriptor(combination);
  // `rawKeyDown` is the form for a key that inserts nothing; sending `keyDown`
  // for one makes Chromium wait for a `char` that never comes.
  await cdp.send("Input.dispatchKeyEvent", {
    type: descriptor.text ? "keyDown" : "rawKeyDown",
    ...descriptor,
  });
  if (descriptor.text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", ...descriptor });
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...descriptor });
}

export async function rectFor(cdp, kind, needle) {
  const rect = await evaluate(cdp, RECT_FOR(kind, needle));
  if (!rect) {
    fail(`No visible element for ${kind} ${JSON.stringify(needle)}`);
  }
  // Scrolling it into view did not put it inside the window: it is clipped by
  // an overflow, or behind something. Say so, rather than dispatching input at
  // a point the window does not cover and reporting that as a click.
  if (rect.offScreen) {
    fail(
      `Found ${kind} ${JSON.stringify(needle)}, but it is outside the window even after scrolling to it ` +
        `(${Math.round(rect.x)},${Math.round(rect.y)}). Open or scroll whatever contains it first.`,
    );
  }
  return rect;
}

/**
 * Call an oRPC route through the renderer's debug bridge.
 *
 * The value is stringified inside the page rather than left to CDP's
 * `returnByValue`, which renders a `Date` as `{}`. A route's timestamps would
 * come back present but empty, which reads as the route having nothing to say
 * rather than as an artifact of how it was fetched.
 *
 * Errors are caught in the page and returned as data for the same reason: oRPC
 * puts the part worth reading on the error object (`code`, and the Zod issues
 * under `data`), and none of that survives being reported as the description of
 * a thrown exception.
 */
export async function callRpc(cdp, route, input) {
  await waitForDebugBridge(cdp);

  const outcome = await evaluate(
    cdp,
    `(async () => {
      try {
        const value = await window.__studioDebug.rpc(${JSON.stringify(route)}, ${JSON.stringify(input) ?? "undefined"});
        if (value && typeof value[Symbol.asyncIterator] === "function") {
          return { iterator: true };
        }
        return { json: JSON.stringify(value) ?? "null" };
      } catch (error) {
        return {
          error: {
            code: error?.code,
            data: error?.data,
            message: error?.message ?? String(error),
          },
        };
      }
    })()`,
  );

  if (outcome.iterator) {
    fail(
      `"${route}" is an event iterator, and one cannot be carried back through a single evaluation.\n` +
        `Poll its plain counterpart instead: task.agentStatus.byIds for task.agentStatus.live.byId.`,
    );
  }

  if (outcome.error) {
    const { code, data, message } = outcome.error;
    if (message.includes("Developer Mode")) {
      fail(
        `${message}\nOr boot a fixture workspace, which pins the preference: --workspace <fixture>.`,
      );
    }
    fail(
      `${route} failed: ${message}${code ? ` (${code})` : ""}` +
        (data === undefined ? "" : `\n${JSON.stringify(data, undefined, 2)}`),
    );
  }

  return JSON.parse(outcome.json);
}

/**
 * A capture taken while the renderer is between loads is a well-formed PNG of
 * an empty page, and nothing in the response says so. HMR reloads the renderer
 * on any file change in the checkout, so a scripted run hits this by being
 * unlucky about timing rather than by doing anything wrong. Check that
 * something is actually mounted first, and say which condition failed.
 */
export async function assertRenderable(cdp) {
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
      "Nothing is mounted yet (mid-reload?). Re-run, or `waitFor` something the page should show.",
    );
  }
}

/**
 * Cropping happens browser-side: `clip` is measured in CSS pixels and the
 * capture already applies the device scale factor, so `scale` stays 1 and the
 * file comes out at native resolution. That is the whole reason to crop here
 * rather than after the fact -- converting a screenshot's device pixels back to
 * the CSS pixels a rect is measured in is where this usually goes wrong.
 *
 * `clip` is only honored on the surface path, which is why that mode is used
 * even though an occluded window can return a uniform frame through it. That is
 * what {@link assertRenderable} covers.
 */
export async function capture(cdp, file, { pad = 0, selector, text } = {}) {
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

/**
 * The accessibility tree under a subject, as indented `role "name"` lines.
 *
 * This is the read to reach for before evaluating your way around the DOM. It
 * answers what is on screen and what each thing is called, in the same terms a
 * click matches on, at roughly a tenth the size of the equivalent HTML. A
 * control that comes back as a bare `button` has no accessible name at all,
 * which is worth knowing directly: it cannot be clicked by text, a screen reader
 * gets the same nothing, and marking it in an evaluation is a workaround for a
 * labeling bug rather than a technique.
 *
 * Ignored nodes are dropped rather than rendered, so what is left is what a
 * consumer of the tree can actually reach. Depth is bounded because the app page
 * is thousands of nodes and a whole-page dump helps nobody; scope with a
 * selector and raise the depth from there.
 */
export async function snapshotTree(cdp, { depth = 12, selector } = {}) {
  await assertRenderable(cdp);
  await cdp.send("Accessibility.enable");

  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));

  let rootId = nodes[0]?.nodeId;
  if (selector) {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) {
      fail(`No element matches ${JSON.stringify(selector)}.`);
    }
    const { nodes: partial } = await cdp.send(
      "Accessibility.getPartialAXTree",
      {
        fetchRelatives: false,
        nodeId,
      },
    );
    rootId = partial[0]?.nodeId;
    for (const node of partial) {
      byId.set(node.nodeId, node);
    }
  }

  const lines = [];
  const walk = (nodeId, level, parentName) => {
    const node = byId.get(nodeId);
    if (!node || level > depth) {
      return;
    }
    const role = node.role?.value;
    const name = node.name?.value;

    // Four kinds of node carry no information a caller can act on. An ignored
    // one is not in the tree at all; `none`/`generic` is the div a layout is
    // built from, which Chrome exposes and nothing can address; an
    // `InlineTextBox` is one line box of the text above it, an artifact of how
    // the text was laid out rather than anything in the page; and a
    // `StaticText` whose words are already the name of the thing above it is
    // that name a second time. Their children can still matter, so each is
    // descended through at the parent's level rather than dropped.
    const isPassthrough =
      node.ignored ||
      role === "none" ||
      role === "generic" ||
      role === "InlineTextBox" ||
      (role === "StaticText" && Boolean(parentName?.includes(name ?? "")));

    if (!isPassthrough) {
      lines.push(
        `${"  ".repeat(level)}- ${role ?? "unknown"}${name ? ` ${JSON.stringify(name)}` : ""}`,
      );
    }
    for (const childId of node.childIds ?? []) {
      walk(
        childId,
        isPassthrough ? level : level + 1,
        isPassthrough ? parentName : name,
      );
    }
  };
  walk(rootId, 0);

  return { depth, nodes: lines.length, selector, tree: lines.join("\n") };
}

/**
 * Wait for a task's agent to stop working, read from `task.agentStatus.byIds`
 * rather than from whatever the page is currently painting.
 *
 * Busy is the `agent.alive` tag: every non-final state of the session machine
 * carries it, so this covers running, paused and mid-tool-call without
 * enumerating them, and it keeps covering them when those states change.
 *
 * Completion is the *absence* of a session, not an `agent.done` tag. The
 * workspace machine drops a session's ref when it finishes, so a task whose
 * turn is over reports no session actors at all -- which is also what a task
 * that has not started one reports. Hence `settleMs`: until the task has been
 * seen busy, idle has to hold rather than count immediately, so a wait issued
 * in the same breath as `message.create` does not return before the session
 * has been spawned.
 *
 * A subagent outliving its parent keeps this waiting, because a status reports
 * tags per session and not which of them is the root.
 */
export async function waitIdle(cdp, { settleMs, taskId, timeoutMs }) {
  // Reads the task first so a wrong id fails saying so, rather than waiting out
  // the whole timeout on a task that was never going to report anything.
  await callRpc(cdp, "workspace.task.byId", { id: taskId });

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let idleSince;
  let sawBusy = false;
  let sessions = [];

  for (;;) {
    const [status] = await callRpc(cdp, "workspace.task.agentStatus.byIds", {
      ids: [taskId],
    });
    sessions = status?.sessionActors ?? [];
    const busy = sessions.some((session) =>
      session.tags.includes("agent.alive"),
    );

    if (busy) {
      idleSince = undefined;
      sawBusy = true;
    } else {
      idleSince ??= Date.now();
      if (sawBusy || Date.now() - idleSince >= settleMs) {
        return {
          idle: true,
          // Whether the turn was watched or merely found finished. `false` on a
          // wait that was meant to follow a prompt means the prompt never
          // started an agent, and the idle being reported is the state from
          // before it.
          sawBusy,
          taskId,
          waitedMs: Date.now() - startedAt,
        };
      }
    }

    if (Date.now() > deadline) {
      fail(
        `Timed out after ${timeoutMs}ms waiting for ${taskId} to go idle.\n` +
          `Sessions: ${JSON.stringify(sessions)}`,
      );
    }
    await sleep(IDLE_POLL_MS);
  }
}

/* eslint-enable perfectionist/sort-modules */
