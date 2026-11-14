#!/usr/bin/env node
// The first-launch proof, with no model: one tool-server process, driven over
// the same MCP transport the tester uses. A brand-new person's launch: the
// welcome, the folder step, the server's unseen sign-in, the rest of setup,
// an empty chat list, and a first message that gets a reply.
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
//   FRT_FIRST_LAUNCH_ACCOUNT=<account file> node proof-fresh.mjs --port <cdp port> --inspect <port> --run <run folder> --chats <chats folder>

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
const page = "";
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
let outcome = "passed";
const startedAt = Date.now();
const shots = {};
try {
  await request("initialize", { capabilities: {}, protocolVersion: "2024-11-05" });
  await call("look");
  shots.firstScreen = calls.length;
  const first = await windowText();
  check("the first screen is the first-launch welcome", /Welcome to Instrument/.test(first) && !/new Instrument/.test(first));
  await click(540, 498); // Get started
  const folder = await windowText();
  check("the folder step comes next", /Where should your Instrument folder live/.test(folder));
  await click(992, 652); // Continue: the folder. The server signs in here, unseen.
  const model = await windowText();
  check("setup goes on to the model, signed in", /Pick your main model/.test(model) && !/Which AI should Instrument use/.test(model));
  await click(992, 676); // Continue: the model
  await click(1010, 675); // Skip: notifications
  await click(992, 675); // Continue: the theme
  shots.name = calls.length;
  const greeting = await windowText();
  check("the last setup screen greets the seeded name", new RegExp(`all set, ${flag("--greets")}`).test(greeting));
  await click(540, 463); // Open Instrument
  shots.emptyList = calls.length;
  const app = await windowText();
  check("the app lands on an empty chat list", /Press New to start a chat/.test(app), app.replaceAll("\n", " | ").slice(0, 160));
  await click(800, 735); // the new chat's box
  await call("type_text", { text: `Reply with exactly this one word and nothing else: ${marker}` });
  await call("press_key", { key: "Enter" });
  let replied = false;
  for (let round = 0; round < 30 && !replied; round++) {
    await call("wait", { seconds: 5 });
    replied = seen(marker) >= 2;
  }
  check("a first message in a new chat got a reply", replied);
  await call("look");
  shots.reply = calls.length;
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
