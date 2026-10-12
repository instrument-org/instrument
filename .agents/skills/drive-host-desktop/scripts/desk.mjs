// Drives a test host's desktop through the Cua Driver running in that host's
// interactive session, and prints compact text: accessibility trees as
// Markdown, images as local file paths.
//
//   node desk.mjs <host> <tool> [key=value ...] [--json '{...}']
//   node desk.mjs <host> tools
//   node desk.mjs <host> describe <tool>
//   node desk.mjs <host> stop
//
// `window=<text>` resolves pid and window_id from the first window whose title
// or app name contains <text>. `el=<n>` addresses element [n] of the most
// recent tree read on that host.
//
// The driver scopes its sessions and tree snapshots to one MCP connection, so
// a tree read in one run could not be acted on in the next if each run
// connected on its own. The first run for a host therefore starts a broker in
// the background that holds one connection over SSH, and every run talks to it
// over a local socket. It exits after BROKER_IDLE_MS without a request.

import { spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect as connectSocket, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const MAX_IMAGE_DIMENSION = 1280;
const BROKER_IDLE_MS = 15 * 60 * 1000;
const BROKER_START_TIMEOUT_MS = 20_000;
const STATE_DIR = path.join(tmpdir(), "desk");
// Sockets live in /tmp because a Unix socket path, plus the suffix ssh adds
// to its control socket while creating it, is capped near 104 bytes on macOS.
const SOCKET_DIR = "/tmp";
const SSH_OPTIONS = [
  "-T",
  "-o",
  "BatchMode=yes",
  "-o",
  "ControlMaster=auto",
  "-o",
  `ControlPath=${SOCKET_DIR}/desk-%C`,
  "-o",
  "ControlPersist=600",
];
const PROFILE_PATH = "~/.instrument/studio-host.json";
const HOST_PATTERN = /^[\w.-]+$/u;

class CliError extends Error {}

try {
  const argv = process.argv.slice(2);
  if (argv[0] === "--broker") await broker(argv[1]);
  else await main(argv);
} catch (error) {
  console.error(`desk: ${error.message}`);
  if (!(error instanceof CliError)) console.error(error.stack);
  process.exitCode = 1;
}

async function main(argv) {
  const [host, tool, ...rest] = argv;
  if (!host || !tool) {
    fail(
      "Usage: desk.mjs <host> <tool> [key=value ...] [--json '{...}'] | tools | describe <tool> | stop",
    );
  }
  if (!HOST_PATTERN.test(host)) fail(`Invalid host ${JSON.stringify(host)}.`);
  if (tool === "stop") {
    await requestBroker(host, "broker/stop", {}, { start: false }).catch(
      () => {},
    );
    return;
  }
  if (tool === "tools") {
    return printTools(await requestBroker(host, "tools/list"));
  }
  if (tool === "describe") {
    return printDescription(await requestBroker(host, "tools/list"), rest[0]);
  }
  const call = (name, args) =>
    requestBroker(host, "tools/call", { name, arguments: args });
  const { grep, ...parsed } = parseArguments(rest);
  const args = await resolveArguments(call, host, tool, parsed);
  printResult(host, tool, await call(tool, args), { grep });
}

function fail(message) {
  throw new CliError(message);
}

function socketPath(host) {
  return path.join(SOCKET_DIR, `desk-${host}.sock`);
}

function logPath(host) {
  return path.join(STATE_DIR, `${host}-broker.log`);
}

/** One request per socket connection: a JSON line out, a JSON line back. */
async function requestBroker(host, method, params = {}, { start = true } = {}) {
  let socket;
  try {
    socket = await openSocket(socketPath(host));
  } catch (error) {
    if (!start) throw error;
    socket = await startBroker(host);
  }
  socket.write(`${JSON.stringify({ method, params })}\n`);
  const reply = JSON.parse(await readLine(socket));
  socket.end();
  if (reply.error) fail(reply.error);
  return reply.result;
}

function openSocket(file) {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(file);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline !== -1) resolve(buffer.slice(0, newline));
    });
    socket.once("error", reject);
    socket.once("close", () => reject(new CliError("The broker hung up.")));
  });
}

async function startBroker(host) {
  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(logPath(host), "w");
  spawn(process.execPath, [process.argv[1], "--broker", host], {
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
  const deadline = Date.now() + BROKER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(150);
    try {
      return await openSocket(socketPath(host));
    } catch {
      // Not listening yet.
    }
  }
  let detail = "";
  try {
    detail = readFileSync(logPath(host), "utf8").trim();
  } catch {
    // No log to show.
  }
  fail(`The broker for ${host} did not start.${detail ? `\n${detail}` : ""}`);
}

async function broker(host) {
  if (!HOST_PATTERN.test(host ?? "")) fail("--broker needs a host.");
  const command = (await readProfile(host)).desktop?.mcp;
  if (typeof command !== "string" || command === "") {
    fail(
      `${host} has no desktop.mcp in ${PROFILE_PATH}. See the drive-host-desktop skill's host enrollment.`,
    );
  }
  const driver = await connectDriver(host, command);
  const file = socketPath(host);
  rmSync(file, { force: true });
  let idle;
  const shutdown = (code) => {
    rmSync(file, { force: true });
    driver.close();
    process.exit(code);
  };
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => shutdown(0), BROKER_IDLE_MS);
  };
  driver.onClose((message) => {
    console.error(message);
    shutdown(1);
  });
  const server = createServer(async (socket) => {
    resetIdle();
    try {
      const { method, params } = JSON.parse(await readLine(socket));
      if (method === "broker/stop") {
        socket.end(`${JSON.stringify({ result: {} })}\n`);
        return shutdown(0);
      }
      const result = await driver.request(method, params);
      socket.end(`${JSON.stringify({ result })}\n`);
    } catch (error) {
      socket.end(`${JSON.stringify({ error: error.message })}\n`);
    }
  });
  server.listen(file);
  process.on("SIGTERM", () => shutdown(0));
  resetIdle();
}

/**
 * The host profile is the file the test-studio-on-* helpers already read.
 * `cat` is an alias of Get-Content in Windows PowerShell, and both shells
 * expand `~`, so one command reads it on every host.
 */
async function readProfile(host) {
  const output = await run("ssh", [
    ...SSH_OPTIONS,
    host,
    `cat ${PROFILE_PATH}`,
  ]);
  try {
    return JSON.parse(output.replace(/^﻿/u, ""));
  } catch {
    fail(`${host}: ${PROFILE_PATH} is not JSON.`);
  }
}

function run(command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new CliError(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function connectDriver(host, command) {
  const child = spawn("ssh", [...SSH_OPTIONS, host, command], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const pending = new Map();
  let closed;
  let buffer = "";
  let nextId = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("{")) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new CliError(message.error.message));
      else waiter.resolve(message.result);
    }
  });
  child.on("close", (code) => {
    const message = `The driver connection closed (${code}).${stderr ? `\n${driverNotice(stderr)}` : ""}`;
    for (const waiter of pending.values()) {
      waiter.reject(new CliError(message));
    }
    pending.clear();
    closed?.(message);
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params = {}) => {
    const id = ++nextId;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) =>
      pending.set(id, { resolve, reject }),
    );
  };
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "desk", version: "1" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  return {
    request,
    onClose: (callback) => (closed = callback),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}

/** Drops the driver's update banner, which it prints on every start. */
function driverNotice(stderr) {
  return stderr
    .split("\n")
    .filter((line) => !/is available|Update with|Release notes/u.test(line))
    .join("\n")
    .trim();
}

function parseArguments(rest) {
  const args = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (token === "--json") {
      Object.assign(args, JSON.parse(rest[++index] ?? "{}"));
      continue;
    }
    const equals = token.indexOf("=");
    if (equals < 1) fail(`Expected key=value, got ${JSON.stringify(token)}.`);
    args[token.slice(0, equals)] = parseValue(token.slice(equals + 1));
  }
  return args;
}

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/u.test(raw)) return Number(raw);
  if (raw.startsWith("[") || raw.startsWith("{")) return JSON.parse(raw);
  return raw;
}

async function resolveArguments(call, host, tool, args) {
  const resolved = { ...args };
  if ("window" in resolved) {
    const query = String(resolved.window).toLowerCase();
    delete resolved.window;
    const listing = await call("list_windows", {});
    const match = listing.structuredContent?.windows?.find(
      (window) =>
        window.title?.toLowerCase().includes(query) ||
        window.app_name?.toLowerCase().includes(query),
    );
    if (!match) fail(`No window matches ${JSON.stringify(query)}.`);
    resolved.pid = match.pid;
    resolved.window_id = match.window_id;
  }
  if ("el" in resolved) {
    const snapshot = readState(host).snapshot;
    if (!snapshot) fail("el= needs a tree read first (get_window_state).");
    resolved.element_token = `${snapshot}:${resolved.el}`;
    delete resolved.el;
  }
  if (tool === "get_window_state") {
    resolved.include_screenshot ??= false;
  }
  if (tool === "get_window_state" || tool === "get_desktop_state") {
    resolved.max_image_dimension ??= MAX_IMAGE_DIMENSION;
  }
  return resolved;
}

function readState(host) {
  try {
    return JSON.parse(
      readFileSync(path.join(STATE_DIR, `${host}.json`), "utf8"),
    );
  } catch {
    return {};
  }
}

function writeState(host, state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, `${host}.json`), JSON.stringify(state));
}

/**
 * `grep=<text>` keeps only the tree lines containing <text>, matched against
 * the whole line, so it finds a control by role as well as by name
 * (`grep=button`), which the driver's own `query` does not.
 */
function printResult(host, tool, result, { grep } = {}) {
  const structured = result.structuredContent;
  if (tool === "get_window_state" && structured?.snapshot_id) {
    writeState(host, { snapshot: structured.snapshot_id });
    const { app_name, window_title, pid, window_id, snapshot_id } = structured;
    console.log(
      `${app_name ?? "?"} "${window_title ?? ""}" pid=${pid} window_id=${window_id} snapshot=${snapshot_id} elements=${structured.returned_element_count ?? structured.element_count}/${structured.total_element_count ?? "?"}${structured.truncated ? " (truncated)" : ""}`,
    );
    if (structured.tree_markdown) {
      const lines = structured.tree_markdown.trimEnd().split("\n");
      const needle =
        grep === undefined ? undefined : String(grep).toLowerCase();
      console.log(
        (needle === undefined
          ? lines
          : lines.filter((line) => line.toLowerCase().includes(needle))
        ).join("\n"),
      );
    }
  } else {
    for (const part of result.content ?? []) {
      if (part.type === "text") console.log(part.text.trimEnd());
    }
  }
  let image = 0;
  for (const part of result.content ?? []) {
    if (part.type !== "image") continue;
    const file = path.join(
      STATE_DIR,
      `${host}-${tool}-${Date.now()}${image++ ? `-${image}` : ""}.png`,
    );
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(file, Buffer.from(part.data, "base64"));
    console.log(`image: ${file}`);
  }
  if (result.isError) process.exitCode = 1;
}

function printTools(listing) {
  for (const tool of listing.tools) {
    console.log(`${tool.name}: ${firstSentence(tool.description)}`);
  }
}

function printDescription(listing, name) {
  const tool = listing.tools.find((candidate) => candidate.name === name);
  if (!tool) fail(`No tool named ${JSON.stringify(name)}.`);
  console.log(`${tool.name}: ${firstSentence(tool.description)}`);
  const required = new Set(tool.inputSchema?.required ?? []);
  for (const [key, schema] of Object.entries(
    tool.inputSchema?.properties ?? {},
  )) {
    if (key === "session") continue;
    const type = schema.enum
      ? schema.enum.join("|")
      : (schema.type ?? "object");
    console.log(
      `  ${key}${required.has(key) ? "*" : ""} (${type}): ${firstSentence(schema.description ?? "")}`,
    );
  }
}

function firstSentence(text) {
  const flat = (text ?? "").replace(/\s+/gu, " ").trim();
  const end = flat.search(/[.!?](\s|$)/u);
  return end === -1 ? flat : flat.slice(0, end + 1);
}
