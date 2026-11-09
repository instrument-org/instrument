/**
 * Replays chats' records on one clock and counts the jumps their transcripts
 * would draw (`src/lib/transcript/flicker.ts`), chat and tasks together, so a
 * task's row sees the task's own card as it was at that moment.
 *
 *   pnpm --filter @instrument-org/workspace script:flicker-inventory <dir>... [--out <file.json>]
 *
 * Each `<dir>` is searched for record folders (a folder holding `ses_*.jsonl`).
 * Records are part snapshots, written as a part starts, gets its input and
 * ends, so a replay sees each of those as a frame but not text streaming
 * between them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  ChatFold,
  historyOf,
  type FoldedSession,
} from "../src/lib/records/fold";
import { FOLD_WAIT_MS, turnsOf } from "../src/lib/transcript/turns-of";
import { workCardOf } from "../src/lib/transcript/work-card";
import { transcriptMessage } from "../src/lib/transcript/transcript-message";
import {
  drawnFrame,
  FlickerTracker,
  type FlickerEvent,
  type TaskView,
} from "../src/lib/transcript/flicker";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, trace: { type: "string" } },
});
if (positionals.length === 0) {
  throw new Error("Usage: flicker-inventory <dir>... [--out <file.json>]");
}

async function recordFolders(dir: string): Promise<string[]> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  if (entries.some((entry) => /^ses_.*\.jsonl$/.test(entry.name))) {
    return [dir];
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("blobs"))
      .map((entry) => recordFolders(path.join(dir, entry.name))),
  );
  return nested.flat();
}

interface Line {
  at: number;
  bytes: Uint8Array;
  name: string;
  order: number;
}

async function linesOf(folder: string): Promise<Line[]> {
  const names = (await fs.readdir(folder)).filter((name) =>
    /^(ses_|settings\.).*\.jsonl$/.test(name),
  );
  const lines: Line[] = [];
  let order = 0;
  for (const name of names) {
    const text = await fs.readFile(path.join(folder, name), "utf8");
    let lastAt = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      let at = lastAt;
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "at" in parsed &&
          typeof parsed.at === "string"
        ) {
          // A log is written in order, so a line never goes before the one above it.
          at = Math.max(lastAt, Date.parse(parsed.at));
        }
      } catch {
        // A torn line folds as the reader would: skipped.
      }
      lastAt = at;
      lines.push({
        at,
        bytes: new TextEncoder().encode(`${line}\n`),
        name,
        order: order++,
      });
    }
  }
  return lines.toSorted((a, b) => a.at - b.at || a.order - b.order);
}

/** Whether the session is working: its last turn has not ended and no stop came after it. */
function isRunning(session: FoldedSession): boolean {
  const last = session.messages.findLast(
    (message) => message.role === "assistant" || message.role === "user",
  );
  if (!last) {
    return false;
  }
  if (
    session.stopped &&
    session.stopped.at.getTime() >= last.metadata.createdAt.getTime()
  ) {
    return false;
  }
  if (last.role === "user") {
    return true;
  }
  // A step being written has no `finishedAt` yet; one that asked for tools goes on.
  const { metadata } = last;
  return (
    !("finishedAt" in metadata && metadata.finishedAt) ||
    ("finishReason" in metadata && metadata.finishReason === "tool-calls")
  );
}

interface Found extends FlickerEvent {
  chat: string;
  session: string;
  isTask: boolean;
}

const found: Found[] = [];
const births = new Map<string, number>();
let frameCount = 0;
let sessionCount = 0;
const folders = (
  await Promise.all(positionals.map((dir) => recordFolders(path.resolve(dir))))
).flat();

for (const folder of folders) {
  const lines = await linesOf(folder);
  const fold = new ChatFold();
  const trackers = new Map<string, FlickerTracker>();
  // An eval run's folder is always `record`, so the folders above it name it.
  const chatName = folder.split(path.sep).slice(-3).join("/");
  const traced = new Map<string, string>();

  const frame = (now: number) => {
    const chat = fold.chat();
    const views = new Map<string, TaskView>();
    const turnsBySession = new Map<string, ReturnType<typeof turnsOf>>();
    // Tasks first, so the chat's task rows read their tasks at this moment.
    const ordered = chat.sessions.toSorted(
      (a, b) => Number(a.parent === undefined) - Number(b.parent === undefined),
    );
    for (const session of ordered) {
      const messages = historyOf(chat, session.id).flatMap(
        (message) => transcriptMessage(message) ?? [],
      );
      const running = isRunning(session);
      const turns = turnsOf(messages, {
        isRunning: running,
        sessionId: session.id,
      });
      turnsBySession.set(session.id, turns);
      if (session.parent !== undefined) {
        const last = turns.at(-1);
        views.set(session.id, {
          card: running && last ? workCardOf(last)?.kind : undefined,
          isWorking: running,
        });
      }
      let tracker = trackers.get(session.id);
      if (!tracker) {
        tracker = new FlickerTracker();
        trackers.set(session.id, tracker);
      }
      const drawn = drawnFrame(turns, now, (id) => views.get(id));
      if (values.trace && chatName.includes(values.trace)) {
        const line = drawn.elements
          .map((each) => `${each.key.slice(-6)}:${each.kind}`)
          .join("  ");
        if (line !== traced.get(session.id)) {
          traced.set(session.id, line);
          console.log(
            `${new Date(now).toISOString().slice(11, 23)} ${session.parent ? "task" : "chat"} ${session.id.slice(-4)} | ${line}`,
          );
        }
      }
      tracker.add(drawn);
      frameCount++;
    }
  };

  for (const [index, line] of lines.entries()) {
    fold.add(line.name, line.bytes);
    const next = lines[index + 1];
    // Lines written in one moment are one frame.
    if (next && next.at === line.at) {
      continue;
    }
    frame(line.at);
    // A turn folds on a clock, not a record: draw the moment it would.
    if (!next || next.at - line.at > FOLD_WAIT_MS) {
      frame(line.at + FOLD_WAIT_MS + 1);
    }
  }

  const chat = fold.chat();
  for (const [sessionId, tracker] of trackers) {
    sessionCount++;
    const session = chat.sessions.find((each) => each.id === sessionId);
    for (const [kind, count] of tracker.births) {
      births.set(kind, (births.get(kind) ?? 0) + count);
    }
    for (const event of tracker.events) {
      found.push({
        ...event,
        chat: chatName,
        isTask: session?.parent !== undefined,
        session: sessionId,
      });
    }
  }
}

const groups = new Map<string, Found[]>();
for (const event of found) {
  if (event.kind === "fold") {
    continue;
  }
  const detail = event.detail.replace(/up \d+ms/, "up <300ms");
  const key = `${event.kind} | ${detail} | ${event.isTask ? "task" : "chat"}`;
  groups.set(key, [...(groups.get(key) ?? []), event]);
}
const ranked = [...groups]
  .map(([key, events]) => ({
    aboveLastTurn: events.filter((event) => event.aboveLastTurn).length,
    chats: new Set(events.map((event) => event.chat)).size,
    count: events.length,
    examples: events.slice(0, 3).map((event) => ({
      at: new Date(event.at).toISOString(),
      chat: event.chat,
      keys: event.keys,
      session: event.session,
    })),
    key,
  }))
  .toSorted((a, b) => b.chats - a.chats || b.count - a.count);

const summary = {
  births: Object.fromEntries(births),
  folders: folders.length,
  frames: frameCount,
  groups: ranked,
  sessions: sessionCount,
};
if (values.out) {
  await fs.writeFile(values.out, JSON.stringify(summary, null, 2));
}
console.log(
  `${folders.length} chats, ${sessionCount} sessions, ${frameCount} frames`,
);
console.log("births:", JSON.stringify(summary.births));
for (const group of ranked.slice(0, 40)) {
  console.log(
    `${String(group.count).padStart(6)} in ${String(group.chats).padStart(4)} chats (${group.aboveLastTurn} above last turn)  ${group.key}`,
  );
}
