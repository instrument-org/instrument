#!/usr/bin/env node
// Plays the tester by hand, with no model: starts the MCP server exactly as
// the tester's session would, sends it the calls given as JSON, and prints
// each result's text (images are saved by the server under the run folder).
//
//   node dry-check.mjs --port 48341 --inspect 9377 --run runs/dry-1 \
//     '{"name":"look"}' '{"name":"click","arguments":{"x":10,"y":10,"i_see":"…","i_expect":"…"}}'

import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv.splice(at, 2)[1];
};
const port = flag("--port");
const inspect = flag("--inspect");
const run = path.resolve(flag("--run") ?? "runs/dry");
const crop = flag("--crop-bottom") ?? "0";
const standIn = flag("--stand-in");
const maxActions = flag("--max-actions");
const calls = argv.map((each) => JSON.parse(each));

const here = path.dirname(new URL(import.meta.url).pathname);
const server = spawn(process.execPath, [path.join(here, "lib/mcp-server.mjs")], {
  env: {
    ...process.env,
    FRT_CROP_BOTTOM: crop,
    FRT_INSPECT_PORT: inspect ?? "",
    FRT_PORT: port,
    FRT_RUN_DIR: run,
    ...(maxActions && { FRT_MAX_ACTIONS: maxActions }),
    ...(standIn && { FRT_STANDIN: path.resolve(standIn) }),
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

await request("initialize", { capabilities: {}, protocolVersion: "2024-11-05" });
const { result } = await request("tools/list");
console.log(`tools: ${result.tools.map((tool) => tool.name).join(", ")}`);
for (const call of calls) {
  const reply = await request("tools/call", call);
  for (const part of reply.result.content) {
    console.log(
      part.type === "text"
        ? `[${call.name}] ${part.text}`
        : `[${call.name}] <image ${Math.round((part.data.length * 3) / 4 / 1024)} KB>`,
    );
  }
}
server.stdin.end();
server.kill();
console.log(`log: ${run}/steps.jsonl`);
