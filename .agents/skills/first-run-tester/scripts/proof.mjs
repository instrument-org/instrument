#!/usr/bin/env node
// The rig proof, with no model: one tool-server process, driven over the same
// MCP transport the tester uses, with no waits of its own between actions.
//
//   setup      welcome, the folder step and the restart it causes, model,
//              notifications, theme; the last screen greets the seeded name
//   a reply    a seeded chat, a prompt naming the seeded HTML file, a reply
//   the page   the file's chip opens it in the side pane; the large preview;
//              Files. In each, text below the first screen paints and
//              scrolling moves it
//   a long turn  a real agent turn of over a minute, sat through with `wait`,
//              with no report of a restart and no unreadable screen
//
// What a step did is checked from outside the tester's view: the chat's
// records on disk, and the app's main process asked for a page's scroll
// position. Every screenshot is kept under the run folder.
//
//   node proof.mjs --port <cdp port> --inspect <port> --run <run folder> --chats <chats folder> --page <html file>

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { connect } from "./lib/screen.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const run = path.resolve(flag("--run"));
const chats = flag("--chats");
const page = path.resolve(flag("--page"));
const inspect = flag("--inspect");
const here = path.dirname(new URL(import.meta.url).pathname);
const PER_CALL_LIMIT_MS = 240_000;

const server = spawn(process.execPath, [path.join(here, "lib/mcp-server.mjs")], {
  env: {
    ...process.env,
    FRT_INSPECT_PORT: inspect,
    FRT_MAX_ACTIONS: "300",
    FRT_MAX_MINUTES: "60",
    FRT_PORT: flag("--port"),
    FRT_RUN_DIR: run,
  },
  stdio: ["pipe", "pipe", "inherit"],
});
const waiting = new Map();
createInterface({ input: server.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  waiting.get(message.id)?.(message);
});
let id = 0;
const request = (method, params) =>
  new Promise((resolve) => {
    id++;
    waiting.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`);
  });

const calls = [];
const checks = [];
const SAID = { i_expect: "proof", i_see: "proof", reaction: "proof" };
let lastPng = null;

async function call(name, args = {}) {
  const began = Date.now();
  const reply = await request("tools/call", {
    arguments: name === "look" ? {} : { ...SAID, ...args },
    name,
  });
  const ms = Date.now() - began;
  const texts = reply.result.content.filter((part) => part.type === "text").map((part) => part.text);
  const image = reply.result.content.find((part) => part.type === "image");
  lastPng = image ? createHash("sha1").update(image.data).digest("hex") : lastPng;
  calls.push({ ms, name, text: texts.join(" | ") });
  console.log(
    `${String(calls.length).padStart(2)} ${name.padEnd(12)} ${String(ms).padStart(6)} ms  ${texts.join(" | ").slice(0, 130)}`,
  );
  if (reply.result.isError || ms > PER_CALL_LIMIT_MS) {
    throw new Error(`call ${calls.length} (${name}) failed: ${texts.join(" ")}`);
  }
  // The server says so when the app restarted under an action and it was not
  // made. Doing it again then is acting on what the call returned, as a
  // tester would, not a wait of this script's own.
  if (texts.some((text) => text.includes("so it did not happen"))) {
    await call(name, args);
  }
  return texts.join(" | ");
}
const click = (x, y) => call("click", { x, y });

function check(name, passed, detail = "") {
  checks.push({ detail, name, passed });
  console.log(`   ${passed ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!passed) {
    throw new Error(`check failed: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/** Asks the app's main process something, on a connection closed at once. */
async function main(expression) {
  const [target] = await (await fetch(`http://127.0.0.1:${inspect}/json/list`)).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    const { result, exceptionDetails } = await cdp.send(
      "Runtime.evaluate",
      {
        awaitPromise: true,
        expression: `(async () => { const electron = process.getBuiltinModule("node:module").createRequire(process.execPath)("electron"); ${expression} })()`,
        returnByValue: true,
      },
      10_000,
    );
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  } finally {
    cdp.close();
  }
}
/** What the app's own window says, as text. */
const windowText = () =>
  main(
    `const own = electron.webContents.getAllWebContents().filter((each) => each.getType() === "window" && each.getURL().includes("/renderer/")).sort((a, b) => b.id - a.id)[0]; return own.executeJavaScript("document.body.innerText");`,
  );
/**
 * Where on the screen the last thing reading `text` is, for a click whose
 * place depends on how a reply happened to wrap. Only the place comes from
 * here; the click itself goes through the tester's tools.
 */
const locate = (text) =>
  main(
    `const own = electron.webContents.getAllWebContents().filter((each) => each.getType() === "window" && each.getURL().includes("/renderer/")).sort((a, b) => b.id - a.id)[0]; return own.executeJavaScript(${JSON.stringify(
      `(() => { const all = [...document.querySelectorAll("a, button, span, [role=button]")].filter((node) => node.textContent.includes(${JSON.stringify("__TEXT__")}) && node.getClientRects().length > 0); const node = all.at(-1); if (!node) return null; const box = node.getBoundingClientRect(); return { x: Math.round(box.x + Math.min(box.width / 2, 60)), y: Math.round(box.y + box.height / 2) }; })()`,
    )}.replace("__TEXT__", ${JSON.stringify(text)}));`,
  );
/** How far each open copy of the seeded page is scrolled, and how tall it is. */
const pageScrolls = () =>
  main(
    `const out = []; for (const each of electron.webContents.getAllWebContents()) { if (each.getType() === "webview" && decodeURI(each.getURL()).endsWith(${JSON.stringify(path.basename(page))})) out.push(await each.executeJavaScript("({ height: document.documentElement.scrollHeight, view: innerHeight, y: Math.round(scrollY) })")); } return out;`,
  );

/** How many times `marker` is in the chats' records: once is the prompt, twice a reply. */
function seen(marker) {
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(at);
      } else if (entry.name.endsWith(".jsonl")) {
        count += readFileSync(at, "utf8").split(marker).length - 1;
      }
    }
  };
  if (existsSync(chats)) {
    walk(chats);
  }
  return count;
}

/** Scrolls where a copy of the page is showing and checks the picture and the page both moved. */
async function scrollsAndPaints(where, x, y, expectCopies) {
  const before = lastPng;
  const start = await pageScrolls();
  check(`${where}: the page is open`, start.length >= expectCopies, `${start.length} open`);
  check(
    `${where}: the page is taller than its view`,
    start.every((each) => each.height > each.view * 2),
    JSON.stringify(start),
  );
  await call("scroll", { amount: 900, x, y });
  const end = await pageScrolls();
  check(
    `${where}: scrolling moved the page`,
    end.filter((each) => each.y >= 600).length >= expectCopies,
    JSON.stringify(end),
  );
  check(`${where}: the screenshot changed with it`, lastPng !== before);
  return calls.length;
}

const stamp = Date.now().toString(36).toUpperCase();
const marker = `QUINCE${stamp}`;
const marker2 = `MEDLAR${stamp}`;
let outcome = "passed";
const startedAt = Date.now();
const shots = {};
try {
  await request("initialize", { capabilities: {}, protocolVersion: "2024-11-05" });
  await call("look");
  await click(539, 456); // Get started
  const restart = await click(992, 676); // Continue: the folder, which restarts the app
  check("the folder step's call returned after the restart", restart.includes("closed its window"));
  await click(992, 675); // Continue: the model
  await click(1010, 675); // Skip: notifications
  await click(992, 675); // Continue: the theme
  shots.name = calls.length;
  const greeting = await windowText();
  check("the last setup screen greets the seeded name", new RegExp(`all set, ${flag("--greets")}`).test(greeting), greeting.split("\n")[0]);
  await click(540, 463); // Open Instrument

  await click(236, 157); // the first seeded chat
  await click(800, 735); // its reply box
  await call("type_text", {
    text: `Reply with exactly this one word and nothing else: ${marker}. The page I mean is ${page}`,
  });
  await call("press_key", { key: "Enter" });
  let replied = false;
  for (let round = 0; round < 30 && !replied; round++) {
    await call("wait", { seconds: 5 });
    replied = seen(marker) >= 2;
  }
  check("the seeded chat got a reply", replied);

  // The chip in the sent message shows the path's end; a suggested follow-up
  // can name the file too, and is not it.
  const chip = await locate(`Documents/${path.basename(page)}`);
  check("the file's chip is in what was sent", chip !== null, JSON.stringify(chip));
  await click(chip.x, chip.y); // the side pane
  shots.sidePane = await scrollsAndPaints("side pane", 1025, 500, 1);
  await click(1128, 101); // the pane's expand button: the large preview
  shots.largePreview = await scrollsAndPaints("large preview", 620, 450, 2);
  await click(1043, 84); // close the preview
  await click(1210, 60); // close the side pane

  await click(800, 735);
  await call("type_text", {
    text: `Run this exact shell command, wait for it to finish however long it takes, and then reply with exactly the one word ${marker2}: python3 -c "import time; time.sleep(75); print(1)"`,
  });
  await call("press_key", { key: "Enter" });
  const turnBegan = Date.now();
  const waitsFrom = calls.length;
  let done = false;
  for (let round = 0; round < 20 && !done; round++) {
    await call("wait", { seconds: 15 });
    done = seen(marker2) >= 2;
  }
  const turnSeconds = Math.round((Date.now() - turnBegan) / 1000);
  check("the long agent turn finished", done);
  check("it ran for a minute or more", turnSeconds >= 60, `${turnSeconds} s`);
  const during = calls.slice(waitsFrom);
  check(
    "no restart was reported while it ran",
    !during.some((each) => /closed its window|restart/i.test(each.text)),
  );
  check(
    "the screen was readable throughout",
    !during.some((each) => /could not see the screen/.test(each.text)),
  );
  shots.longTurn = calls.length;

  await click(38, 215); // Files
  await click(327, 133); // Documents
  await call("double_click", { x: 617, y: 133 }); // the seeded page
  shots.files = await scrollsAndPaints("Files", 800, 450, 1);
  await call("look");
} catch (error) {
  outcome = `FAILED: ${error.message}`;
}
server.stdin.end();
server.kill();
const steps = existsSync(path.join(run, "steps.jsonl"))
  ? readFileSync(path.join(run, "steps.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  : [];
const longest = calls.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0, name: "none" });
const result = {
  calls: calls.length,
  checks,
  longestCall: { ms: longest.ms, name: longest.name, number: calls.indexOf(longest) + 1 },
  outcome,
  perCallLimitMs: PER_CALL_LIMIT_MS,
  rigNotes: steps.filter((step) => step.rigNote).map((step) => `${step.rigNote} at step ${step.step}`),
  // The numbered screenshot that shows each thing, under shots/.
  shots,
  totalSeconds: Math.round((Date.now() - startedAt) / 1000),
};
writeFileSync(path.join(run, "proof.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, checks: `${checks.filter((each) => each.passed).length}/${checks.length} passed` }));
process.exit(outcome === "passed" ? 0 : 1);
