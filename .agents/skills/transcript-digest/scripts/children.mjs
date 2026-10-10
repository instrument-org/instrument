// Tasks a chat started, read from the chat's own chat.db, where each is a
// session whose parentId is the chat's, and exported with the repo's
// exporter. The only part of the digest that needs this machine's chat
// folders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { analyze, parseTranscript } from "./parse.mjs";

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

// The store keeps every record in one key/value table; a session's row is
// keyed `sessions:<id>` and its value is superjson text in `blob`.
function readSessions(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare("select blob from sessions where key like 'sessions:%'")
      .all()
      .map((row) => JSON.parse(String(row.blob)).json);
  } finally {
    db.close();
  }
}

export function loadChildren(root) {
  // `chatDir` in the app's export (`taskDir` in an older one), `source` in
  // script:dump-session-transcript's.
  const chatDir =
    root.p.meta.chatDir ?? root.p.meta.taskDir ?? root.p.meta.source ?? "";
  const db = path.join(chatDir, ".instrument", "chat.db");
  if (!chatDir || !fs.existsSync(db)) {
    return [{ id: "(the chat's tasks)", missing: db }];
  }
  const sessions = readSessions(db);
  const chatSession =
    root.p.meta.sessionId ?? sessions.find((s) => !s.parentId)?.id;
  const tasks = sessions
    .filter((s) => s.parentId && s.parentId === chatSession)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  // One cached export per task, overwritten on each run, so the path the
  // digest prints stays valid for reading the child's transcript directly.
  const cache = path.join(process.env.TMPDIR ?? "/tmp", "transcript-digest");
  fs.mkdirSync(cache, { recursive: true });
  return tasks.map((task) => {
    const id = task.handle ? `${task.handle} ${task.id}` : task.id;
    const md = path.join(cache, `${task.id}.md`);
    execFileSync(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@instrument-org/workspace",
        "run",
        "script:dump-session-transcript",
        chatDir,
        "--session",
        task.id,
        "--output",
        md,
      ],
      { cwd: REPO, stdio: "ignore" },
    );
    const p = parseTranscript(md);
    return { id, file: md, p, a: analyze(p) };
  });
}
