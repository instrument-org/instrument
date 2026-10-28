// Reads a chat's records (the ses_*.jsonl logs from `.instrument/chats/<id>/`, or an eval's copy of them) into a
// timeline the replay wireframe draws: what you said, what the chat said, each step with when it started and ended,
// each task with its own steps, the asks, and the requests that failed. Times are seconds from the chat's start.
//
//   node records-to-timeline.mjs <records-dir>   prints the timeline as JSON

import fs from "node:fs";
import path from "node:path";

const secs = (iso, t0) => Math.round((Date.parse(iso) - t0) / 100) / 10;

/** The words of a user message, without the wrappers the app adds around a message sent mid-turn. */
const userText = (text) =>
  text
    .replace(/<instrument-system-note>[\s\S]*?<\/instrument-system-note>/g, "")
    .replace(/<\/?user_message>/g, "")
    .trim();

/** The steps of one session, keyed by tool call: what it said it was doing, when it started, when it ended. */
function readSession(lines, t0) {
  const header = lines.find((o) => o.t === "session");
  const roles = new Map();
  const texts = new Map();
  const steps = new Map();
  const tabs = new Map();
  const out = { id: header.id, parent: header.parent ?? null, name: header.startedAs, start: secs(header.at, t0), you: [], says: [], steps: [], errors: [], stops: [], wakes: [] };
  for (const o of lines) {
    if (o.t === "message") {
      const m = o.message;
      roles.set(m.id, m.role);
      const meta = m.metadata ?? {};
      if (m.role === "assistant" && meta.error) out.errors.push({ t: secs(meta.finishedAt ?? o.at, t0), message: String(meta.error.message ?? "request failed") });
      if (m.role === "assistant" && meta.finishReason === "stop" && meta.finishedAt) out.stops.push(secs(meta.finishedAt, t0));
      continue;
    }
    if (o.t !== "part") continue;
    const p = o.part;
    const role = roles.get(p.metadata?.messageId);
    const at = secs(o.at, t0);
    if (p.type === "text" && role === "user") {
      const text = userText(p.text ?? "");
      if (text) out.you.push({ t: at, text });
    } else if (p.type === "text" && role === "assistant") {
      const id = p.metadata.id;
      const seen = texts.get(id);
      if (seen) seen.text = p.text;
      else if (p.text?.trim()) texts.set(id, { t: at, text: p.text });
    } else if (p.type === "data-taskEvent") {
      for (const e of p.data?.events ?? []) out.wakes.push({ t: at, session: e.sessionId, status: e.status, summary: e.summary ?? "", files: e.files ?? [] });
    } else if (p.type?.startsWith("tool-") && p.toolCallId) {
      const input = typeof p.input === "object" && p.input ? p.input : {};
      let s = steps.get(p.toolCallId);
      if (!s) {
        // A step's label is its explanation, the one specific sentence the agent writes for that call; its activity is
        // the short label it shares with the calls around it (three searches run at once can all be "Checking current
        // plan prices"), kept for a design that groups steps under it.
        s = { t: at, end: null, tool: p.type.slice(5), label: input.explanation || input.activity || p.type.slice(5), activity: input.activity || "" };
        const task = /instrument task new\b[^\n]*?--name\s+(['"])(.*?)\1/.exec(String(input.command ?? ""));
        if (task) s.startsTask = task[2];
        if (p.type === "tool-ask_permission") s.ask = { reason: input.reason ?? "", target: input.target ?? "", kind: input.kind ?? "" };
        steps.set(p.toolCallId, s);
      }
      if (p.state === "output-available" || p.state === "output-error") {
        s.end = at;
        if (p.state === "output-error") s.failed = true;
        readTabs(s, String(input.command ?? ""), typeof p.output?.output === "string" ? p.output.output : "", at);
      }
    }
  }
  out.says = [...texts.values()].filter((x) => x.text.trim());
  out.steps = [...steps.values()].map((s) => ({ ...s, end: s.end ?? s.t }));
  out.tabs = [...tabs.values()];

  /**
   * The chat's tabs, from what its commands said: `instrument tab open` names each tab it opened, agent-browser's
   * page notes name the page its own tab is on, and `instrument tab close` ends one. A step that names a tab, or
   * drives agent-browser, is using that tab while it runs.
   */
  function readTabs(step, command, text, at) {
    const uses = new Set();
    for (const m of text.matchAll(/^Opened (\S+) \(tab (tab_\w+)\)/gm)) {
      tabs.set(m[2], { id: m[2], url: m[1], title: "", t: at, closed: null });
      uses.add(m[2]);
    }
    for (const m of text.matchAll(/Page after `\w+` on “(.*?)”, (https?:\/\/\S+)/g)) {
      const tab = tabs.get("browser") ?? { id: "browser", t: at, closed: null };
      Object.assign(tab, { url: m[2], title: m[1] });
      tabs.set("browser", tab);
    }
    for (const m of command.matchAll(/instrument tab close\s+(tab_\w+)/g)) if (tabs.has(m[1])) tabs.get(m[1]).closed = at;
    for (const m of command.matchAll(/tab_\w+/g)) uses.add(m[0]);
    if (/\bagent-browser\b/.test(command)) uses.add("browser");
    if (uses.size) step.uses = [...uses];
  }
  const last = Math.max(out.start, ...out.says.map((x) => x.t), ...out.steps.map((x) => x.end), ...out.stops);
  out.end = last;
  return out;
}

export function recordsToTimeline(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^ses_.*\.jsonl$/.test(f));
  const parsed = files.map((f) =>
    fs
      .readFileSync(path.join(dir, f), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
  );
  const t0 = Math.min(...parsed.map((lines) => Date.parse(lines.find((o) => o.t === "session").at)));
  const sessions = parsed.map((lines) => readSession(lines, t0));
  const chat = sessions.find((s) => !s.parent);
  const tasks = sessions.filter((s) => s.parent).sort((a, b) => a.start - b.start);
  // A task is the one its starting step named, else the next one to begin after that step.
  for (const step of chat.steps.filter((s) => s.startsTask)) {
    const task = tasks.find((t) => t.name === step.startsTask && !t.startedBy) ?? tasks.find((t) => !t.startedBy && t.start >= step.t);
    if (task) {
      task.startedBy = step.t;
      step.task = task.id;
      const wake = chat.wakes.find((w) => w.session === task.id);
      task.doneAt = wake ? wake.t : task.end;
      task.summary = wake?.summary ?? task.says.at(-1)?.text ?? "";
      task.files = wake?.files ?? [];
    }
  }
  const duration = Math.max(chat.end, ...tasks.map((t) => t.doneAt ?? t.end));
  return { duration, chat, tasks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node records-to-timeline.mjs <records-dir>");
  process.stdout.write(JSON.stringify(recordsToTimeline(dir), null, 2) + "\n");
}
