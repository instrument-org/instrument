#!/usr/bin/env node
// node render.mjs <transcript.md> [--out file.html] [--children]
// The run read like the chat it was: your messages and its replies as
// bubbles, and between them, open, the activities it worked through and the
// actions inside each. Tasks a thread started sit inline where they ran.
import fs from "node:fs";
import path from "node:path";

import { loadChildren } from "../../transcript-digest/scripts/children.mjs";
import {
  analyze,
  parseTranscript,
  short,
} from "../../transcript-digest/scripts/parse.mjs";

const args = process.argv.slice(2);
const file = args.find(
  (a, i) => !a.startsWith("--") && args[i - 1] !== "--out",
);
if (!file) {
  console.error(
    "usage: render.mjs <transcript.md> [--out file.html] [--children]",
  );
  process.exit(2);
}
const outFile = args.includes("--out")
  ? args[args.indexOf("--out") + 1]
  : file.replace(/\.md$/, "") + ".html";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const failed = (c) =>
  !!(c.incomplete || c.result?.error || (c.result?.exit ?? 0) !== 0);
const say = (c) => c.args.explanation || c.args.title || c.label || c.name;

// One duration format everywhere, colored by how long it is.
const dur = (ms) => {
  if (ms == null) return `<span class="d">–</span>`;
  const s = ms / 1000;
  const txt =
    s < 10
      ? `${s.toFixed(1)}s`
      : s < 60
        ? `${Math.round(s)}s`
        : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
  return `<span class="d ${s >= 60 ? "long" : s >= 15 ? "mid" : ""}">${txt}</span>`;
};

// The words the agent said to the user in a step, without its reasoning.
const reply = (e) =>
  e.say
    .split("\n")
    .filter((l) => !l.startsWith(">") && !l.startsWith("*[Reasoning]*"))
    .join("\n")
    .trim();

const load = (f, id) => {
  const p = parseTranscript(f);
  return { id, p, a: analyze(p) };
};
const root = load(file, "main");
const children = args.includes("--children")
  ? loadChildren(root).filter((c) => c.p)
  : [];

// A conversation as blocks: messages, and activities (steps grouped under
// the start_activity that opened them, or under their first action).
function blocks(l) {
  const out = [];
  let cur = null;
  const tl = l.a.timeline;
  for (let k = 0; k < tl.length; k++) {
    const e = tl[k];
    if (e.kind === "user") {
      // What the person typed sits in <user_message>; anything outside it is
      // context the app attached. A turn with no user_message is the app's.
      const typed = e.raw.match(/<user_message>([\s\S]*?)<\/user_message>/);
      const note = !typed && e.say.startsWith("<instrument-system-note>");
      const text = typed
        ? typed[1]
        : e.say.replace(/<\/?instrument-system-note>/g, "");
      out.push({ kind: note ? "note" : "you", text: text.trim(), at: e.at });
      cur = null;
      continue;
    }
    const act = e.calls.find((c) => c.name === "start_activity");
    const work = e.calls.filter((c) => c.name !== "start_activity");
    if (act || (!cur && work.length)) {
      cur = {
        kind: "activity",
        at: e.at,
        title: act ? act.args.title : short(say(work[0]), 90),
        start: e.at,
        end: e.at,
        calls: [],
        steps: [],
      };
      out.push(cur);
    }
    if (cur) {
      cur.steps.push(e);
      cur.calls.push(...work);
      cur.end = Math.max(cur.end, e.at + e.wall);
    }
    const endsTurn = !tl[k + 1] || tl[k + 1].kind === "user";
    const words = reply(e);
    // A turn that ended badly shows how it ended rather than half a thought.
    const open = e.calls.find((c) => c.incomplete);
    const ended =
      e.meta.finishReason &&
      !["stop", "tool-calls"].includes(e.meta.finishReason)
        ? e.meta.finishReason
        : null;
    if (endsTurn && (open || ended))
      out.push({
        kind: "agent",
        text: "",
        at: e.at,
        stopped: open
          ? `stopped while ${say(open).toLowerCase()} (${ended ?? open.incomplete})`
          : `ended: ${ended}`,
      });
    else if (endsTurn && words)
      out.push({ kind: "agent", text: words, at: e.at, stopped: null });
  }
  return out;
}

function activity(b) {
  const fails = b.calls.filter(failed);
  const pills = [
    fails.length ? `<span class="pill bad">${fails.length} failed</span>` : "",
    b.calls.some((c) => c.incomplete)
      ? `<span class="pill bad">stopped</span>`
      : "",
  ].join("");
  const rows = b.calls
    .map(
      (c) =>
        `<li class="${failed(c) ? "bad" : ""}"><details><summary><span class="mark">${failed(c) ? "✕" : "✓"}</span><span class="what">${esc(short(say(c), 140))}</span>${dur(c.dur)}</summary><div class="more"><pre>${esc(
          (
            c.args.command ??
            Object.entries(c.args)
              .filter(([k]) => k !== "explanation")
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")
          ).slice(0, 1500),
        )}</pre>${c.result ? `<pre class="out">${esc(c.result.head)}</pre>` : ""}<p class="ln">${esc(c.name)} · transcript line ${c.line}</p></div></details></li>`,
    )
    .join("");
  const total = b.end - b.start;
  const model = b.steps.reduce((s, e) => s + e.model, 0);
  const why =
    total > 15000 && model > total / 2
      ? `<p class="why">${dur(model)} of it the model thinking, over ${b.steps.length} ${b.steps.length === 1 ? "step" : "steps"}</p>`
      : "";
  return `<section class="act"><header><span class="title">${esc(b.title)}${pills}</span>${dur(total)}</header>${why}${rows ? `<ul>${rows}</ul>` : ""}</section>`;
}

function conversation(l, childBlocks = []) {
  const bs = blocks(l);
  // Child task turns go after the last thread block that started before them.
  const html = [];
  const pending = [...childBlocks].sort((x, y) => x.at - y.at);
  bs.forEach((b, i) => {
    html.push(block(b));
    const nextAt = bs[i + 1]?.at ?? Infinity;
    while (pending.length && pending[0].at < nextAt)
      html.push(pending.shift().html);
  });
  for (const p of pending) html.push(p.html);
  return html.join("\n");
}

const md = (t) =>
  esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
function block(b) {
  if (b.kind === "you")
    return `<div class="you"><div class="bubble">${md(short(b.text, 600))}</div></div>`;
  if (b.kind === "note")
    return `<p class="note">${esc(short(b.text.replace(/\s+/g, " "), 240))}</p>`;
  if (b.kind === "agent")
    return `<div class="agent"><div class="bubble">${b.text ? md(short(b.text, 900)) : ""}${b.stopped ? `<span class="stoptxt">${esc(b.stopped)}</span>` : ""}</div></div>`;
  return activity(b);
}

// A child task's turns, each as one inset card placed on the thread's clock.
function childTurns(c) {
  const bs = blocks(c);
  const turns = [];
  for (const b of bs) {
    if (b.kind === "you" || b.kind === "note" || !turns.length)
      turns.push({ at: b.at, parts: [] });
    turns.at(-1).parts.push(b);
  }
  return turns.map((t, i) => ({
    at: t.at,
    html: `<div class="child"><p class="childhead">Task · ${esc(c.p.meta.taskName)}${turns.length > 1 ? ` · turn ${i + 1}` : ""}</p>${t.parts.map((b) => (b.kind === "you" ? `<p class="brief"><b>Brief</b> ${esc(short(b.text, 400))}</p>` : block(b))).join("\n")}</div>`,
  }));
}

const m = root.p.meta;
const firstAsk = root.a.timeline.find((e) => e.kind === "user")?.say ?? "";
const name =
  m.taskName === "Instrument"
    ? `Thread: ${short(firstAsk.replace(/\s+/g, " "), 60)}`
    : m.taskName;
const all = [root, ...children];
const totalWork = all.reduce(
  (s, l) => s + l.a.steps.reduce((x, e) => x + e.wall, 0),
  0,
);
const fails = all.reduce(
  (s, l) => s + l.a.steps.flatMap((e) => e.calls).filter(failed).length,
  0,
);
const actions = all.reduce(
  (s, l) =>
    s +
    l.a.steps.flatMap((e) => e.calls).filter((c) => c.name !== "start_activity")
      .length,
  0,
);
const served = [
  ...new Set(
    all
      .flatMap((l) => l.a.steps.map((s) => s.meta.served ?? s.meta.model))
      .filter(Boolean),
  ),
].join(", ");

const body = `<div class="wrap">
<p class="kicker">${esc([m.currentAppVersion, served].filter(Boolean).join(" · "))}</p>
<h1 class="h">${esc(name)}</h1>
<p class="lead">${dur(totalWork)} of work, ${actions} actions${fails ? `, <span class="badtxt">${fails} failed</span>` : ""}${children.length ? `, ${children.length} ${children.length === 1 ? "task" : "tasks"} started` : ""}.</p>
<div class="chat">${conversation(root, children.flatMap(childTurns))}</div>
<footer class="muted small">Durations: <span class="d">under 15s</span> <span class="d mid">15s to a minute</span> <span class="d long">a minute or more</span>. Activities are the ones the agent announced; actions use the explanation it gave each call; click one for its command and output. Made from ${esc(all.map((l) => path.basename(l.p.file)).join(" + "))}.</footer>
</div>`;

const css = `<style>
:root{color-scheme:light dark;--bg:light-dark(#fafaf9,#141210);--card:light-dark(#fff,#1c1917);--muted:light-dark(#f5f5f4,#1c1917);--border:light-dark(#e7e5e4,#292524);--fg:light-dark(#171412,#f1ede9);--fg-muted:light-dark(#6d655f,#9a918a);--brand:#0e7869;--you:light-dark(oklch(from var(--brand) 0.85 0.05 h),oklch(from var(--brand) 0.36 0.06 h));--bad-bg:light-dark(#f8e4e8,#331721);--bad:light-dark(#7a1f30,#ef8ba3);--bad-strong:light-dark(#3f121a,#f9ccd6);--warn:light-dark(#b54708,#f0b03f);--ok:light-dark(#176229,#6ddc85);--code:light-dark(#1c1917,#0c0b0a);--code-fg:#e4ded9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
.kicker{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted)}
.h{font-size:1.75rem;font-weight:600;line-height:1.2;margin:.2rem 0 .4rem}
.lead{color:var(--fg-muted);margin:0 0 2rem}
.muted{color:var(--fg-muted)} .small{font-size:.8rem} .badtxt{color:var(--bad)}
.chat{display:flex;flex-direction:column;gap:.9rem}
.you{display:flex;justify-content:flex-end}
.you .bubble{max-width:80%;border-radius:1rem;border-top-right-radius:.375rem;padding:.5rem .875rem;background:var(--you);white-space:pre-wrap;font-size:.875rem}
.agent{display:flex}
.agent .bubble{max-width:85%;border-radius:1rem;border-top-left-radius:.375rem;padding:.5rem .875rem;background:var(--card);border:1px solid var(--border);white-space:pre-wrap;font-size:.875rem;line-height:1.5}
.note{text-align:center;font-size:.78rem;color:var(--fg-muted);margin:.25rem 2rem}
.act{border-left:2px solid var(--border);padding:.1rem 0 .1rem .9rem;margin-left:.25rem}
.act header{display:flex;justify-content:space-between;gap:1rem;align-items:baseline}
.title{font-weight:600;font-size:.875rem}
.act ul{list-style:none;padding:0;margin:.3rem 0 0}
.act li summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:1rem 1fr auto;gap:.5rem;padding:.15rem .25rem;border-radius:4px;font-size:.82rem;color:var(--fg-muted)}
.act li summary::-webkit-details-marker{display:none}
.act li summary:hover{background:var(--muted)}
.mark{color:var(--ok)}
.act li.bad summary,.act li.bad .mark{color:var(--bad)}
.d{font-variant-numeric:tabular-nums;font-size:.8rem;color:var(--fg-muted);white-space:nowrap}
.d.mid{color:var(--warn);font-weight:600}
.d.long{color:var(--bad);font-weight:700}
.more{margin:.2rem 0 .5rem 1.5rem}
.more pre{background:var(--code);color:var(--code-fg);padding:.5rem .7rem;border-radius:4px;white-space:pre-wrap;word-break:break-word;font-size:.74rem;max-height:16rem;overflow:auto;margin:.25rem 0}
.more pre.out{background:var(--muted);color:var(--fg)}
.why{font-size:.78rem;color:var(--fg-muted);margin:.1rem 0 0}
.why .d{font-size:.78rem}
.bubble code{font-size:.8em;padding:0 .25rem;border-radius:3px;background:var(--muted)}
.stoptxt{color:var(--bad);font-size:.82rem}
.ln{font-size:.72rem;color:var(--fg-muted);margin:0}
.pill{display:inline-block;font-size:.68rem;font-weight:500;padding:.05rem .45rem;border-radius:99px;margin-left:.5rem;vertical-align:1px;background:var(--bad-bg);color:var(--bad-strong)}
.child{margin:.25rem 0 .25rem 1.5rem;padding:.75rem .9rem;border-radius:.75rem;background:var(--muted);display:flex;flex-direction:column;gap:.7rem}
.childhead{font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--fg-muted);margin:0}
.brief{font-size:.82rem;margin:0;color:var(--fg-muted)}
.brief b{color:var(--fg);margin-right:.3rem}
footer{margin-top:3rem}
footer .d{margin:0 .4rem}
</style>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title>${css}</head><body><main>${body}</main></body></html>`;
fs.writeFileSync(outFile, html);
console.log(outFile);
