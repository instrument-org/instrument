// The Stop and SubagentStop hook: each edited checkout's own scripts/turn-end.ts
// over the files the turn edited, around the shared format hook, all handed back
// to the session as one reason.
//
// What an edit makes stale is written again before the format hook's tests read
// it. The format hook takes the session's list of edits as it runs, so the list
// is read first. They run one after another, since other sessions are usually
// working on the same machine, inside the hook's 180 seconds: the format hook
// caps its tests at 60, and turn-end.ts each of its two at 25.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [formatHook] = process.argv.slice(2);

function run(command, args, { cwd, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 170_000,
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => resolve(out));
    child.on("close", () => resolve(out));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** The files the turn edited, from the list agent-hooks keeps per session. */
function sessionEdits(data) {
  const id = data.agent_id
    ? `${data.session_id}.${data.agent_id}`
    : data.session_id;
  const list = path.join(os.tmpdir(), "instrument-agent-hooks", `${id}.txt`);
  return [list, `${list}.pending`].flatMap((file) =>
    existsSync(file) ? readFileSync(file, "utf8").split("\n") : [],
  );
}

/** The checkout a file is in: the nearest folder with a `.git` of its own. */
function checkoutOf(file) {
  let folder = path.dirname(file);
  while (!existsSync(path.join(folder, ".git"))) {
    const parent = path.dirname(folder);
    if (parent === folder) {
      return undefined;
    }
    folder = parent;
  }
  return folder;
}

const input = readFileSync(0, "utf8");
let data = {};
let edits = [];
try {
  data = JSON.parse(input);
  edits = [...new Set(sessionEdits(data).filter(Boolean))];
} catch {
  // The format hook says what is wrong with its input.
}

const byCheckout = new Map();
for (const file of edits) {
  const root = existsSync(file) ? checkoutOf(file) : undefined;
  if (root && existsSync(path.join(root, "scripts/turn-end.ts"))) {
    byCheckout.set(root, [...(byCheckout.get(root) ?? []), file]);
  }
}
let left = "";
const turnEnd = async (...flags) => {
  for (const [root, files] of byCheckout) {
    const args = ["scripts/turn-end.ts", ...flags, ...files];
    left += await run(process.execPath, args, { cwd: root });
  }
};

await turnEnd("--regenerate");
const formatted = await run(process.execPath, [formatHook], { input });
// A stop the hook already answered goes through, so a session gets one attempt
// and never a loop. What its last edits made stale is still written again.
if (data.stop_hook_active !== true) {
  await turnEnd();
}

let answer = {};
try {
  answer = JSON.parse(formatted || "{}");
} catch {
  // Nothing it said can be read.
}
if (left.trim() && data.stop_hook_active !== true) {
  const ours = `Checks that read what you edited, and would fail at landing, found these. Fix them before finishing:\n\n${left.trim().slice(0, 6000)}`;
  answer = {
    decision: "block",
    reason: answer.reason ? `${answer.reason}\n\n${ours}` : ours,
  };
}
process.stdout.write(JSON.stringify(answer));
