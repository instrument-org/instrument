// Tasks a chat started, read from the chat's own records, where each is a
// session whose header names the session it was started from, and exported
// with the repo's exporter. The only part of the digest that needs this
// machine's chat folders.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { analyze, parseTranscript } from "./parse.mjs";

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

/**
 * Every session in the chat's record folder, from the first line of each
 * log: one file per session per device, named `<session>.<device>.jsonl`,
 * whose first line is the session's header (`t: "session"`). A session
 * carried on by another device has a file per device, so the headers are
 * keyed by session id and the first one read wins.
 */
function readSessions(chatDir) {
  const sessions = new Map();
  for (const name of fs.readdirSync(chatDir).toSorted()) {
    if (!name.endsWith(".jsonl") || name.startsWith("marks.")) {
      continue;
    }
    let header;
    try {
      const text = fs.readFileSync(path.join(chatDir, name), "utf8");
      header = JSON.parse(text.slice(0, text.indexOf("\n")));
    } catch {
      continue;
    }
    if (header?.t === "session" && !sessions.has(header.id)) {
      sessions.set(header.id, header);
    }
  }
  return [...sessions.values()];
}

export function loadChildren(root) {
  // `chatDir` in the app's export (`taskDir` in an older one), `source` in
  // script:dump-session-transcript's.
  const chatDir =
    root.p.meta.chatDir ?? root.p.meta.taskDir ?? root.p.meta.source ?? "";
  if (!chatDir || !fs.existsSync(chatDir)) {
    return [{ id: "(the chat's tasks)", missing: chatDir || "no chat folder" }];
  }
  const sessions = readSessions(chatDir);
  if (sessions.length === 0) {
    return [{ id: "(the chat's tasks)", missing: `records in ${chatDir}` }];
  }
  const chatSession =
    root.p.meta.sessionId ?? sessions.find((s) => !s.parent)?.id;
  const tasks = sessions
    .filter((s) => s.parent && s.parent === chatSession)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return tasks.map((task) => {
    const id = task.handle ? `${task.handle} ${task.id}` : task.id;
    const md = exportSession(chatDir, task.id);
    const p = parseTranscript(md);
    return { id, file: md, p, a: analyze(p) };
  });
}

/**
 * Renders one session of the chat in `chatDir` (its own, when `sessionId` is
 * absent) with script:dump-session-transcript, and returns the file. One
 * cached export per session, overwritten on each run, so the path the digest
 * prints stays valid for reading the transcript directly.
 */
export function exportSession(chatDir, sessionId) {
  const cache = path.join(process.env.TMPDIR ?? "/tmp", "transcript-digest");
  fs.mkdirSync(cache, { recursive: true });
  const md = path.join(cache, `${sessionId ?? path.basename(chatDir)}.md`);
  execFileSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      "@instrument-org/workspace",
      "run",
      "script:dump-session-transcript",
      path.resolve(chatDir),
      ...(sessionId ? ["--session", sessionId] : []),
      "--output",
      md,
    ],
    { cwd: REPO, stdio: "ignore" },
  );
  return md;
}
