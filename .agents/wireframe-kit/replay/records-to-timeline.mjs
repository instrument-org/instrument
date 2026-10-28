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
  const calls = new Map();
  const thought = new Map();
  const out = { id: header.id, parent: header.parent ?? null, name: header.startedAs, start: secs(header.at, t0), you: [], says: [], steps: [], errors: [], stops: [], wakes: [] };
  for (const o of lines) {
    if (o.t === "message") {
      const m = o.message;
      roles.set(m.id, m.role);
      const meta = m.metadata ?? {};
      if (m.role === "assistant" && meta.error) out.errors.push({ t: secs(meta.finishedAt ?? o.at, t0), message: String(meta.error.message ?? "request failed") });
      if (m.role === "assistant" && meta.finishReason === "stop" && meta.finishedAt) out.stops.push(secs(meta.finishedAt, t0));
      if (m.role === "assistant") calls.set(m.id, { ...calls.get(m.id), ...meta });
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
      if (seen) Object.assign(seen, { text: p.text, end: at });
      else if (p.text?.trim()) texts.set(id, { t: at, end: at, text: p.text, call: p.metadata.messageId });
    } else if (p.type === "reasoning") {
      thought.set(p.metadata?.messageId, secs(p.metadata?.endedAt ?? o.at, t0));
    } else if (p.type === "data-fromChat" && p.data?.kind === "assignment") {
      out.brief = String(p.data.text ?? "");
    } else if (p.type === "data-appEvent") {
      // A sign-in card is answered when the app it asked for turns up connected.
      for (const step of steps.values()) {
        const c = step.connect;
        if (c && c.answeredAt == null && step.end != null && p.data?.apps?.[c.slug]?.connected) {
          c.answeredAt = at;
          out.wakes.push({ t: at, session: null, status: "connected", summary: "", files: [] });
        }
      }
    } else if (p.type === "data-browserStatus") {
      // The browser's own list of tabs names the page each is on, which a command that sent its output elsewhere never said.
      for (const b of p.data?.tabs ?? []) {
        const tab = [...tabs.values()].find((x) => x.url === b.url);
        if (tab && !tab.title) tab.title = String(b.title ?? "").replace(/^\(\d+\+?\)\s*/, "");
      }
    } else if (p.type === "data-taskEvent") {
      for (const e of p.data?.events ?? []) out.wakes.push({ t: at, session: e.sessionId, status: e.status, summary: e.summary ?? "", files: e.files ?? [] });
    } else if (p.type?.startsWith("tool-") && p.toolCallId) {
      const input = typeof p.input === "object" && p.input ? p.input : {};
      let s = steps.get(p.toolCallId);
      if (!s) {
        // A step's label is its explanation, the one specific sentence the agent writes for that call; its activity is
        // the short label it shares with the calls around it (three searches run at once can all be "Checking current
        // plan prices"), kept for a design that groups steps under it.
        // A step starts when the chat begins writing its call, which the part's createdAt stamps, not when the call is
        // written down: a call that carries a task's instructions can take seconds to write, and its activity, the
        // first thing in it, says what those seconds are.
        const begun = p.metadata?.createdAt ? Math.min(at, secs(p.metadata.createdAt, t0)) : at;
        s = { t: begun, end: null, tool: p.type.slice(5), label: input.explanation || input.activity || p.type.slice(5), activity: input.activity || "", call: p.metadata?.messageId };
        // One command can start several tasks; each names its own.
        const names = [...String(input.command ?? "").matchAll(/instrument task new\b[^\n]*?--name[\s=]+(['"])(.*?)\1/g)].map((m) => m[2]);
        if (names.length) Object.assign(s, { startsTask: names[0], startsTasks: names });
        if (p.type === "tool-ask_permission") s.ask = { reason: input.reason ?? "", target: input.target ?? "", kind: input.kind ?? "" };
        if (p.type === "tool-choose") s.choose = { question: input.question ?? "", choices: input.choices ?? [] };
        steps.set(p.toolCallId, s);
      }
      if (p.state === "output-available" || p.state === "output-error") {
        // A question to choose from ends its step once it's asked; the person's answer comes back on the same call later.
        if (s.choose?.question && p.output?.answer) {
          Object.assign(s.choose, { answer: p.output.answer, answeredAt: at });
          out.wakes.push({ t: at, session: null, status: "answered", summary: "", files: [] });
        }
        else if (!s.choose || s.end == null) s.end = at;
        // An ask is "asked" once its card is up, and answered when a later result says how the person answered.
        const asked = p.output?.state;
        if (s.ask && asked && asked !== "asked" && s.ask.answeredAt == null) Object.assign(s.ask, { answer: asked, answeredAt: at });
        if (p.state === "output-error") s.failed = true;
        const app = p.type === "tool-connect_app" && p.output?.apps?.find((x) => x.state === "asked");
        if (app && !s.connect) s.connect = { name: app.name, site: app.site ?? "", slug: app.slug, kind: app.kind ?? "sign-in", reason: input.reason ?? "" };
        readTabs(s, String(input.command ?? ""), typeof p.output?.output === "string" ? p.output.output : "", at);
      }
    }
  }
  // A block of words is written down once it's finished, so it streamed in before that: from the call's first word
  // (when it was sent plus how long its first word took), or from the end of its reasoning if that came later, up to
  // when it was written down.
  out.says = [...texts.values()]
    .filter((x) => x.text.trim())
    .map((x) => {
      const { call } = x;
      const meta = calls.get(call);
      const first = meta?.createdAt && meta.msToFirstChunk != null ? secs(meta.createdAt, t0) + meta.msToFirstChunk / 1000 : x.end;
      const start = Math.min(x.end, Math.max(first, thought.get(call) ?? -Infinity));
      return { ...x, t: Math.round(start * 10) / 10 };
    });
  out.steps = [...steps.values()].map((s) => ({ ...s, end: s.end ?? s.t }));
  out.tabs = [...tabs.values()];
  // Starting a task ends the turn there and then, with the call that started it rather than a reply, so its end is
  // when the chat stops working too.
  for (const step of out.steps) if (step.startsTasks) out.stops.push(step.end);
  out.stops.sort((a, b) => a - b);

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
    // A page agent-browser opened, when its notes went elsewhere: the tab is on it from when the step began.
    for (const m of command.matchAll(/agent-browser open\s+["']?(https?:\/\/[^\s"']+)/g))
      if (!tabs.get("browser")?.url) tabs.set("browser", { id: "browser", url: m[1], title: "", t: step.t, closed: null });
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
  for (const [step, name] of chat.steps.flatMap((s) => (s.startsTasks ?? []).map((n) => [s, n]))) {
    const task = tasks.find((t) => t.name === name && !t.startedBy) ?? tasks.find((t) => !t.startedBy && t.start >= step.t);
    if (task) {
      task.startedBy = step.t;
      step.tasks = [...(step.tasks ?? []), task.id];
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
