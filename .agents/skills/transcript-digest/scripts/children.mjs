// Tasks an orchestrator thread started, found by folder name anywhere in the
// thread and exported from their own task.db with the repo's exporter. The
// only part of the digest that needs this machine's task folders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { analyze, parseTranscript } from "./parse.mjs";

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

export function loadChildren(root) {
  const tasksDir = path.dirname(root.p.meta.taskDir ?? "");
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
    const dir = path.join(tasksDir, id);
    if (!fs.existsSync(path.join(dir, ".instrument", "task.db")))
      return { id, missing: dir };
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
