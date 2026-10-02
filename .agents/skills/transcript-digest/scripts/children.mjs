// Tasks a chat started, found by folder name anywhere in the
// chat and exported from their own task.db with the repo's exporter. The
// only part of the digest that needs this machine's task folders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { analyze, parseTranscript } from "./parse.mjs";

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

// Where a task the chat named can be: inside the chat's own chat folder
// (`chats/<chat>/tasks/<id>`), flat beside it for a chat with no chat
// folder (`tasks/<id>`), or inside another chat of the same workspace.
function candidateDirs(taskDir, id) {
  const parent = path.dirname(taskDir);
  const dirs = [path.join(taskDir, "tasks", id), path.join(parent, id)];
  const kind = path.basename(parent);
  if (kind === "chats" || kind === "tasks") {
    const workspace = path.dirname(parent);
    dirs.push(path.join(workspace, "tasks", id));
    const chats = path.join(workspace, "chats");
    for (const chat of fs.existsSync(chats) ? fs.readdirSync(chats) : [])
      dirs.push(path.join(chats, chat, "tasks", id));
  }
  return dirs;
}

export function loadChildren(root) {
  const taskDir = root.p.meta.taskDir ?? "";
  const ids = new Set();
  for (const e of root.p.events)
    for (const m of e.body
      .join("\n")
      .matchAll(/tasks\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)/g))
      ids.add(m[1]);
  if (!ids.size) return [];
  // One cached export per task, overwritten on each run, so the path the
  // digest prints stays valid for reading the child's transcript directly.
  const cache = path.join(process.env.TMPDIR ?? "/tmp", "transcript-digest");
  fs.mkdirSync(cache, { recursive: true });
  return [...ids].map((id) => {
    const tried = candidateDirs(taskDir, id);
    const dir = tried.find((candidate) =>
      fs.existsSync(path.join(candidate, ".instrument", "task.db")),
    );
    if (!dir) return { id, missing: tried[0] };
    const md = path.join(cache, `${id}.md`);
    execFileSync(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@instrument-org/workspace",
        "run",
        "script:dump-session-transcript",
        dir,
        "--output",
        md,
      ],
      { cwd: REPO, stdio: "ignore" },
    );
    const p = parseTranscript(md);
    return { id, file: md, p, a: analyze(p) };
  });
}
