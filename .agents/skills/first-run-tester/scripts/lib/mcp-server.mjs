#!/usr/bin/env node
// The only thing the tester can touch: an MCP server (stdio, no dependencies)
// whose tools are a screen, a pointer, a keyboard and a notebook. Each action
// carries the think-aloud fields, and every call is logged with its
// screenshots, so a run reads like a transcript laid beside a person's.
//
// Configured by the environment (set by run.mjs, never visible to the tester):
//   FRT_RUN_DIR        where the log and screenshots go
//   FRT_PORT           the app's CDP port
//   FRT_INSPECT_PORT   the app's main-process inspector port (the outside guard)
//   FRT_MAX_ACTIONS    actions before the session ends (default 40)
//   FRT_MAX_MINUTES    minutes before the session ends (default 25)
//   FRT_CROP_BOTTOM    pixels cut from the bottom of every screenshot (a dev
//                      build's developer strip)
//   FRT_STANDIN        account file whose sign-in stands in for the browser

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { describeOutside, guardOutside } from "./outside.mjs";
import { connect, openScreen } from "./screen.mjs";

const env = process.env;
const RUN_DIR = env.FRT_RUN_DIR;
const PORT = Number(env.FRT_PORT);
const INSPECT_PORT = env.FRT_INSPECT_PORT ? Number(env.FRT_INSPECT_PORT) : undefined;
const MAX_ACTIONS = Number(env.FRT_MAX_ACTIONS ?? 40);
const MAX_MINUTES = Number(env.FRT_MAX_MINUTES ?? 25);
const CROP_BOTTOM = Number(env.FRT_CROP_BOTTOM ?? 0);
// A first launch has no workspace, and the app keeps both its sign-in and its
// developer-mode preference in one. So until setup has placed the workspace,
// a dev build shows its developer strip (cut from the picture, 23 points),
// and the account in this file can only be signed in once setup reaches the
// step that asks which AI to use. The server does both then, before the
// tester sees that step: see `firstLaunchSignIn`.
const FIRST_LAUNCH_ACCOUNT = env.FRT_FIRST_LAUNCH_ACCOUNT || undefined;
const DEV_STRIP = 23;
let firstLaunchPending = Boolean(FIRST_LAUNCH_ACCOUNT);
const cropNow = () => (firstLaunchPending ? DEV_STRIP : CROP_BOTTOM);
const STANDIN = env.FRT_STANDIN || undefined;
const SETTLE_MS = Number(env.FRT_SETTLE_MS ?? 500);

if (!RUN_DIR || !PORT) {
  console.error("mcp-server: FRT_RUN_DIR and FRT_PORT are required");
  process.exit(2);
}
const SHOTS = path.join(RUN_DIR, "shots");
mkdirSync(SHOTS, { recursive: true });
const STEPS = path.join(RUN_DIR, "steps.jsonl");
const STUMBLES = path.join(RUN_DIR, "stumbles.jsonl");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = Date.now();
const screen = openScreen({ port: PORT });
let guard;
let step = 0;
let actions = 0;
let finished = false;
let lastShot = null;
// Where a tool call is, so a call that never comes back says what it waited on.
let stage = "idle";

const elapsed = () => {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const log = (file, record) => appendFileSync(file, `${JSON.stringify(record)}\n`);

// --- nothing on the real screen ----------------------------------------------

// The app under test is held off screen. Should anything of its ever be on
// the display of the person at this Mac (a system panel the guards missed),
// the instance is ended at once and the session with it.
let breach = null;
if (env.FRT_ONSCREEN_BIN && env.FRT_SUPERVISOR_PID) {
  const check = () => {
    if (breach) {
      return;
    }
    let pid;
    try {
      pid = execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")[0];
    } catch {
      return; // Restarting.
    }
    if (!pid) {
      return;
    }
    let shown = "";
    try {
      shown = execFileSync(env.FRT_ONSCREEN_BIN, [pid], { encoding: "utf8" }).trim();
    } catch {
      return;
    }
    if (shown) {
      breach = shown;
      try {
        process.kill(-Number(env.FRT_SUPERVISOR_PID), "SIGTERM");
      } catch {
        // Already gone.
      }
      const error = `The app put a window on the real screen (${shown}); the instance was stopped.`;
      log(STEPS, { at: new Date().toISOString(), elapsed: elapsed(), harnessError: error, step });
      writeFileSync(
        path.join(RUN_DIR, "rig-failed.json"),
        `${JSON.stringify({ at: new Date().toISOString(), elapsed: elapsed(), error, step }, null, 2)}\n`,
      );
    }
  };
  setInterval(check, 1500);
}

// --- the screen, as the tester gets it -----------------------------------

// A window with nothing drawn in it compresses to a few kilobytes.
const BLANK_BYTES = 8000;
let restartNote = null;
let unreadableNote = null;
// The window the last picture was of, so the pointer goes to the same one.
let screenOf;

/** One picture of the screen: the app's own capture where the main process can be asked, the debug protocol's otherwise. */
async function picture(file) {
  if (guard) {
    const shot = await guard.capture(cropNow());
    if (!shot) {
      throw new Error("the app has no window open");
    }
    screenOf = shot.id;
    screen.setZoom(shot.zoom);
    if (file) {
      writeFileSync(file, shot.png);
    }
    return shot;
  }
  await screen.refresh(5000);
  return screen.capture(file, { cropBottom: CROP_BOTTOM });
}

/**
 * A screenshot, saved under the step. A window that has not drawn yet (the
 * app coming up) is waited for. What the tester is told about a wait is only
 * that the screen could not be read: whether the app restarted is known from
 * its process (`waitForApp`), never guessed from a blank picture.
 */
async function shoot(label) {
  const name = `${String(step).padStart(3, "0")}-${label}.png`;
  const file = path.join(SHOTS, name);
  const began = Date.now();
  let shot;
  let last;
  for (;;) {
    try {
      shot = await picture(file);
    } catch (error) {
      shot = undefined;
      last = error;
    }
    if (shot && shot.png.length >= BLANK_BYTES) {
      break;
    }
    if (Date.now() - began > 150_000) {
      if (shot && shot.png.length > 0) {
        break;
      }
      throw new Error(`no picture of the app's window could be had (${last?.message ?? "blank"})`);
    }
    await sleep(2000);
  }
  const waited = Date.now() - began;
  if (waited > 4000) {
    log(STEPS, {
      at: new Date().toISOString(),
      elapsed: elapsed(),
      rigNote: "screen-unreadable",
      seconds: Math.round(waited / 1000),
      step,
    });
    if (!restartNote && waited > 15_000) {
      unreadableNote = `This test could not see the screen for about ${Math.round(waited / 1000)} seconds. That is the test's own trouble, not something the app did.`;
    }
  }
  lastShot = { file: `shots/${name}`, height: shot.height, width: shot.width };
  return { ...lastShot, png: shot.png };
}

/**
 * On a first launch, once setup has placed the workspace and stands at the
 * step that asks which AI to use: signs the app in as the seeded account (the
 * sign-in itself happens in a web browser, which this rig cannot follow),
 * turns developer mode off as a released build has it, and loads the window
 * again so setup shows where it now stands. The tester never sees that step.
 */
async function firstLaunchSignIn() {
  if (!firstLaunchPending) {
    return;
  }
  const account = JSON.parse(readFileSync(FIRST_LAUNCH_ACCOUNT, "utf8"));
  await screen.refresh(undefined, screenOf);
  const outcome = await screen.evaluate(`(async () => {
    const it = await window.__studioDebug.rpc("setup.live.state");
    const { value } = await it.next();
    await it.return?.();
    if (value.step !== "choose-ai") return "at " + value.step;
    await window.__studioDebug.rpc("billing.dev.setDevToken", { token: ${JSON.stringify(account.token)} });
    const url = performance.getEntriesByType("resource").map((entry) => entry.name)
      .find((name) => /\\/client\\/rpc\\/client\\.ts/.test(name)) ?? "/client/rpc/client.ts";
    const { rpcClient } = await import(url);
    // The app's own switch for running its agent's programs inside the
    // harness's sandbox, and its notice about that closed (see prepare.mjs).
    await rpcClient.preferences.setRunProgramsWithoutSandbox.call({ enabled: true });
    const version = await rpcClient.preferences.getAppVersion.call();
    for (const off of ["did-not-start", "no-seatbelt"]) {
      for (const choice of ["allowed", "refused"]) {
        await rpcClient.notices.dismiss.call({ id: "sandbox-off-" + off + "-" + choice + "-" + (version?.version ?? version) });
      }
    }
    await rpcClient.preferences.setDeveloperMode.call({ enabled: false });
    return "signed in";
  })()`);
  if (outcome !== "signed in") {
    return;
  }
  await screen.reload();
  firstLaunchPending = false;
  log(STEPS, {
    at: new Date().toISOString(),
    elapsed: elapsed(),
    rigNote: "first-launch-sign-in",
    step,
  });
  await sleep(3000);
}

/**
 * Holds a call until the app is there to act on: when its main process is on
 * its way out, or none answers, the app is restarting, and this waits for
 * the next process. Answers whether it had to. With this before and after
 * every action, no click is sent to a window that is going away and no call
 * returns while the app is down.
 */
async function waitForApp() {
  if (!guard) {
    return false;
  }
  let restarted = false;
  const deadline = Date.now() + 200_000;
  for (;;) {
    const state = await guard.peek();
    if (state && !state.leaving) {
      break;
    }
    restarted = true;
    if (Date.now() > deadline) {
      throw new Error("the app did not come back after it went to restart");
    }
    await sleep(1000);
  }
  if (restarted) {
    restartNote =
      "The app closed its window and opened again, as an app does when it restarts itself. (In this test that took a while; on a real Mac it takes a few seconds, so the wait itself is not worth a comment.)";
    log(STEPS, { at: new Date().toISOString(), elapsed: elapsed(), restarted: true, step });
  }
  return restarted;
}

/**
 * Waits for the screen to come to rest after an action, so a call does not
 * return in the middle of something the app is visibly doing: the app's own
 * "Instrument will restart to finish" screen spins for a few seconds before
 * the app goes down, and a click sent then is lost. The screen is at rest
 * when four looks in a row show at most two pictures (still, or only a text
 * cursor blinking). It stops at once when the app starts to leave, which the
 * wait after it then sees through, and gives up after twelve seconds, since
 * some things move for minutes (a reply being written).
 */
async function settle() {
  await sleep(SETTLE_MS);
  const deadline = Date.now() + 12_000;
  const frames = [];
  let window = screenOf;
  for (;;) {
    if (guard) {
      const state = await guard.peek();
      if (!state || state.leaving) {
        return;
      }
    }
    let png;
    try {
      png = (await picture()).png;
    } catch {
      return;
    }
    // Another window in front (setup's closing for the app's) starts the count again.
    if (screenOf !== window) {
      window = screenOf;
      frames.length = 0;
    }
    frames.push(createHash("sha1").update(png).digest("hex"));
    if (frames.length > 4) {
      frames.shift();
    }
    if (frames.length === 4 && new Set(frames).size <= 2) {
      return;
    }
    if (Date.now() > deadline) {
      log(STEPS, {
        at: new Date().toISOString(),
        elapsed: elapsed(),
        rigNote: "settle-cap",
        step,
      });
      return;
    }
    await sleep(300);
  }
}

function inWindow(x, y) {
  if (!lastShot) {
    return "Look at the screen first.";
  }
  if (x < 0 || y < 0 || x >= lastShot.width || y >= lastShot.height) {
    return `(${x}, ${y}) is outside the window, which is ${lastShot.width} by ${lastShot.height}.`;
  }
  return null;
}

// --- standing in for the browser -----------------------------------------

/**
 * Signs the app in as the stand-in account, the way coming back from the
 * browser would have: the session token, the waiting sign-in ended, and the
 * window loaded again so it shows where setup now stands.
 */
async function standInForBrowser() {
  const account = JSON.parse(readFileSync(STANDIN, "utf8"));
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const [target] = (await response.json()).filter((each) => each.type === "page");
  const cdp = await connect(target.webSocketDebuggerUrl);
  const rpc = (route, input) =>
    cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `window.__studioDebug.rpc(${JSON.stringify(route)}${input ? `, ${JSON.stringify(input)}` : ""}).then(() => "ok", (error) => "failed: " + String(error?.message ?? error))`,
      returnByValue: true,
    });
  const set = await rpc("billing.dev.setDevToken", { token: account.token });
  await rpc("auth.cancelSignIn");
  await cdp.send("Page.reload");
  cdp.close();
  await sleep(5000);
  return set.result.value === "ok";
}

/** What happened outside the window since the last call, in a person's terms. */
async function outsideNotes() {
  const notes = [];
  if (restartNote) {
    notes.push(restartNote);
    restartNote = null;
  }
  if (unreadableNote) {
    notes.push(unreadableNote);
    unreadableNote = null;
  }
  stage = "outsideNotes drain";
  for (const note of screen.takeNotes()) {
    log(STEPS, {
      at: new Date().toISOString(),
      elapsed: elapsed(),
      outside: note,
      rigNote: "blocked-outside",
      step,
    });
    notes.push(
      note.kind === "file-chooser"
        ? "The Mac's file picker opened so you could choose a file. This test can't show it, so it was closed with Cancel."
        : `An alert came up: "${note.message}". This test can't show it, so it was dismissed.`,
    );
  }
  if (!guard) {
    return notes;
  }
  guard.reconnect();
  const events = await guard.drain();
  for (const event of events) {
    log(STEPS, {
      at: new Date().toISOString(),
      elapsed: elapsed(),
      outside: event,
      rigNote: "blocked-outside",
      step,
    });
    if (
      STANDIN &&
      event.kind === "browser" &&
      String(event.detail).includes("/auth-desktop/start")
    ) {
      const ok = await standInForBrowser();
      notes.push(
        ok
          ? "Your web browser came to the front. There you signed in with your Google account and started the free trial on Instrument's website, and then you came back to the app. (This test did the browser part for you, so you did not see those pages and have nothing to say about them.)"
          : "Your web browser came to the front, but this test could not finish the sign-in there.",
      );
      continue;
    }
    notes.push(describeOutside(event));
  }
  return notes;
}

// --- tools ----------------------------------------------------------------

const THINK = {
  i_expect: {
    description:
      "What you expect to happen when you do this, in your own words, before you see the result.",
    type: "string",
  },
  i_see: {
    description:
      "What you see on the screen right now and what you make of it, in your own words. Say it the way you would say it out loud.",
    type: "string",
  },
  reaction: {
    description:
      'Your reaction to what your previous action did: did it do what you expected, and did anything surprise, confuse or annoy you? Say "as expected" when nothing did. Leave empty only on your first action.',
    type: "string",
  },
};
const point = {
  x: { description: "Pixels from the left edge of the last screenshot.", type: "integer" },
  y: { description: "Pixels from the top edge of the last screenshot.", type: "integer" },
};
const action = (description, properties, required) => ({
  description,
  inputSchema: {
    properties: { ...THINK, ...properties },
    required: ["i_see", "i_expect", ...required],
    type: "object",
  },
});

const TOOLS = {
  click: action("Click the mouse at a point on the screen.", point, ["x", "y"]),
  double_click: action("Double-click at a point on the screen.", point, ["x", "y"]),
  drag: action(
    "Press the mouse button at one point, move to another, and let go.",
    {
      from_x: point.x,
      from_y: point.y,
      to_x: { description: "Where to let go, from the left edge.", type: "integer" },
      to_y: { description: "Where to let go, from the top edge.", type: "integer" },
    },
    ["from_x", "from_y", "to_x", "to_y"],
  ),
  finish: {
    description:
      "End the session. Call it when you are done, when you are stuck for good, or when you are told the session is over.",
    inputSchema: {
      properties: {
        got_done: {
          description: "What you actually managed to get done, and what you did not.",
          type: "string",
        },
        overall: {
          description:
            "What you would tell the person who asked you to try this, in a few honest sentences.",
          type: "string",
        },
      },
      required: ["overall", "got_done"],
      type: "object",
    },
  },
  hover: action("Move the mouse to a point and rest it there.", point, ["x", "y"]),
  look: {
    description:
      "Look at the screen without doing anything. Use it to start, and whenever you want to see whether something has changed.",
    inputSchema: { properties: {}, type: "object" },
  },
  note_stumble: {
    description:
      "Write down a moment where you stumbled, the moment it happens: you were confused, misread something, hit a dead end, did not know what to do next, got an error, or something looked broken. One call per stumble.",
    inputSchema: {
      properties: {
        severity: {
          description:
            "blocker: you could not go on. major: it cost you real time or you nearly gave up. minor: a moment of doubt. cosmetic: it just looked off.",
          enum: ["blocker", "major", "minor", "cosmetic"],
          type: "string",
        },
        what_happened: {
          description: "What you were trying to do, what you saw, and what threw you.",
          type: "string",
        },
        what_i_wanted: {
          description: "What you expected or would have wanted instead.",
          type: "string",
        },
      },
      required: ["what_happened", "severity"],
      type: "object",
    },
  },
  pick_menu_item: action(
    "Choose an item from a menu this test told you popped up, by its exact name.",
    { label: { description: "The item's name, as listed.", type: "string" } },
    ["label"],
  ),
  press_key: action(
    'Press a key or a key combination, such as "Enter", "Escape", "Tab", "Backspace", "ArrowDown", "Cmd+A" or "Cmd+V".',
    { key: { type: "string" } },
    ["key"],
  ),
  right_click: action("Right-click at a point on the screen.", point, ["x", "y"]),
  scroll: action(
    "Scroll with the mouse over a point. A positive amount scrolls down, a negative one up; 300 is about a third of the window.",
    { ...point, amount: { type: "integer" } },
    ["x", "y", "amount"],
  ),
  type_text: action(
    "Type on the keyboard. The text goes wherever the cursor is, so click a text box first.",
    { text: { type: "string" } },
    ["text"],
  ),
  wait: action(
    "Wait and watch, for when the app is busy and you would sit and wait.",
    { seconds: { description: "1 to 60.", maximum: 60, minimum: 1, type: "integer" } },
    ["seconds"],
  ),
};

const image = (png) => ({
  data: png.toString("base64"),
  mimeType: "image/png",
  type: "image",
});
const text = (value) => ({ text: value, type: "text" });

async function perform(name, args) {
  switch (name) {
    case "click":
      return screen.click(args.x, args.y);
    case "double_click":
      return screen.click(args.x, args.y, { count: 2 });
    case "drag":
      return screen.drag(args.from_x, args.from_y, args.to_x, args.to_y);
    case "hover":
      return screen.move(args.x, args.y);
    case "pick_menu_item": {
      if (!(await guard?.pickMenuItem(args.label))) {
        throw new Error(`No menu is up with an item named "${args.label}".`);
      }
      return;
    }
    case "press_key":
      return screen.key(args.key);
    case "right_click":
      return screen.click(args.x, args.y, { button: "right" });
    case "scroll":
      return screen.scroll(args.x, args.y, args.amount);
    case "type_text":
      return screen.type(args.text);
    case "wait":
      return sleep(Math.min(60, Math.max(1, args.seconds)) * 1000);
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

async function call(name, args) {
  if (finished) {
    return [text("The session is over.")];
  }
  if (name === "finish") {
    finished = true;
    log(STEPS, { at: new Date().toISOString(), elapsed: elapsed(), finish: args, step });
    writeFileSync(path.join(RUN_DIR, "finish.json"), `${JSON.stringify(args, null, 2)}\n`);
    return [text("Thank you. The session is over.")];
  }
  if (name === "note_stumble") {
    const record = {
      at: new Date().toISOString(),
      elapsed: elapsed(),
      screenshot: lastShot?.file ?? null,
      step,
      ...args,
    };
    log(STUMBLES, record);
    log(STEPS, { ...record, stumble: true });
    return [text(`Noted at step ${step}.`)];
  }
  if (breach) {
    return [
      text(
        "The test rig had to close the app, so the session ends here. Note any stumble you have not written down yet, then call finish.",
      ),
    ];
  }
  const minutes = (Date.now() - startedAt) / 60_000;
  if (actions >= MAX_ACTIONS || minutes >= MAX_MINUTES) {
    return [
      text(
        "You are out of time for today. Note any stumble you have not written down yet, then call finish.",
      ),
    ];
  }
  if (name === "look") {
    step++;
    stage = "waitForApp";
    await waitForApp();
    stage = "shoot";
    const shot = await shoot("look");
    stage = "outsideNotes";
    const notes = await outsideNotes();
    stage = "idle";
    log(STEPS, {
      at: new Date().toISOString(),
      elapsed: elapsed(),
      screenshot: shot.file,
      step,
      tool: "look",
    });
    return [
      text(`Step ${step}, ${elapsed()} in. The window is ${shot.width} by ${shot.height}.`),
      ...notes.map(text),
      image(shot.png),
    ];
  }

  const points =
    name === "drag"
      ? [
          [args.from_x, args.from_y],
          [args.to_x, args.to_y],
        ]
      : args.x !== undefined
        ? [[args.x, args.y]]
        : [];
  for (const [x, y] of points) {
    const refusal = inWindow(x, y);
    if (refusal) {
      return [text(refusal)];
    }
  }
  if (!lastShot) {
    return [text("Look at the screen first.")];
  }

  step++;
  actions++;
  const before = lastShot.file;
  const began = new Date().toISOString();
  let error;
  stage = "waitForApp before";
  // An app that restarted since the last call shows a new screen, which the
  // tester has not seen, so what it meant to do is not done to it.
  const skipped = (await waitForApp()) && name !== "wait";
  stage = "guard.ensure";
  await guard?.ensure();
  stage = "screen.refresh";
  await screen.refresh(undefined, screenOf);
  if (!skipped) {
    stage = `perform ${name}`;
    try {
      await perform(name, args);
    } catch (caught) {
      // A click the app's window took badly is the tester's to hear about;
      // anything wrong with the rig itself is thrown by the steps around it.
      error = caught.message;
    }
  }
  if (name !== "wait" && !skipped) {
    stage = "settle";
    await settle();
  }
  stage = "waitForApp after";
  await waitForApp();
  stage = "firstLaunchSignIn";
  await firstLaunchSignIn();
  stage = "shoot";
  const shot = await shoot("after");
  stage = "outsideNotes";
  const notes = await outsideNotes();
  stage = "idle";
  if (skipped) {
    notes.unshift(
      "The app restarted itself just as you went to do that, so it did not happen. Look at the screen as it is now before deciding what to do.",
    );
  }
  const { i_expect, i_see, reaction, ...input } = args;
  log(STEPS, {
    action: actions,
    at: began,
    before,
    elapsed: elapsed(),
    error,
    i_expect,
    i_see,
    input,
    reaction_to_previous: reaction ?? null,
    screenshot: shot.file,
    skipped: skipped || undefined,
    step,
    tool: name,
  });
  return [
    text(
      `${error ? `That did not work: ${error} ` : ""}Step ${step}, ${elapsed()} in, action ${actions} of ${MAX_ACTIONS}. This is the screen now (${shot.width} by ${shot.height}).`,
    ),
    ...notes.map(text),
    image(shot.png),
  ];
}

// --- MCP over stdio ---------------------------------------------------------

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return send({
      id,
      jsonrpc: "2.0",
      result: {
        capabilities: { tools: {} },
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        serverInfo: { name: "screen", version: "0.1.0" },
      },
    });
  }
  if (method === "ping") {
    return send({ id, jsonrpc: "2.0", result: {} });
  }
  if (method === "tools/list") {
    return send({
      id,
      jsonrpc: "2.0",
      result: {
        tools: Object.entries(TOOLS)
          .filter(([name]) => name !== "pick_menu_item" || INSPECT_PORT)
          .map(([name, tool]) => ({ name, ...tool })),
      },
    });
  }
  if (method === "tools/call") {
    try {
      if (INSPECT_PORT && !guard) {
        guard = await guardOutside({ inspectPort: INSPECT_PORT });
      }
      const callBegan = Date.now();
      const content = await Promise.race([
        call(params.name, params.arguments ?? {}),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`the app did not answer for four minutes (at ${stage})`)),
            240_000,
          ),
        ),
      ]);
      // A wait is as long as it was asked to be; only time beyond that is slow.
      const asked = params.name === "wait" ? Number(params.arguments?.seconds ?? 0) * 1000 : 0;
      if (Date.now() - callBegan - asked > 30_000) {
        log(STEPS, {
          at: new Date().toISOString(),
          elapsed: elapsed(),
          rigNote: "slow-call",
          seconds: Math.round((Date.now() - callBegan) / 1000),
          step,
          tool: params.name,
        });
      }
      return send({ id, jsonrpc: "2.0", result: { content } });
    } catch (error) {
      log(STEPS, { at: new Date().toISOString(), harnessError: error.message, step });
      finished = true;
      writeFileSync(
        path.join(RUN_DIR, "rig-failed.json"),
        `${JSON.stringify({ at: new Date().toISOString(), elapsed: elapsed(), error: error.message, step, tool: params.name }, null, 2)}\n`,
      );
      return send({
        id,
        jsonrpc: "2.0",
        result: {
          content: [text(`The test rig failed (${error.message}). The session is over.`)],
          isError: true,
        },
      });
    }
  }
  if (id !== undefined) {
    send({ error: { code: -32601, message: `Unknown method ${method}` }, id, jsonrpc: "2.0" });
  }
}

// One call at a time, in order: an action and its screenshot never interleave
// with the next.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  const message = JSON.parse(line);
  queue = queue.then(() => handle(message));
});
