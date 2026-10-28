// ---- the replay: one chat's records, drawn in the design at any moment, as a prototype with a scrubber under it
// build-replay.mjs puts this after the design's pieces, with TL (the timeline from records-to-timeline.mjs) and
// REPLAY ({ title, chat, at, line, source }) defined above it. From the design it needs says, working, workedLine,
// head, DOT, pillDark and pillSoft; the rest is the kit's.

/** The step runs opened in the transcript, by when their first step started. */
const OPEN = new Set();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inlineMd = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, `<code class="rounded bg-foreground/[0.06] px-1 text-[12.5px]">$1</code>`);
const baseName = (p) => p.replace(/^workspace:/, "").split("/").pop();
const extOf = (p) => (p.split(".").pop() || "").toLowerCase();

/** A file the chat linked, as the transcript's file card, with its own kind's mark. */
const replayFileCard = (p) =>
  `<div class="flex w-90 max-w-[85%] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"><span class="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-white shadow-xs ring-1 ring-border">${fileMark(extOf(p))}</span><span class="flex min-w-0 flex-col"><span class="truncate text-sm">${esc(baseName(p))}</span><span class="text-[12px] text-muted-foreground">${esc(extOf(p).toUpperCase())}</span></span></div>`;

/** The chat's Markdown, drawn plainly: paragraphs, lists, tables, code, and a ```files block as file cards. */
const md = (text) => {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  let t = text.replace(/```files\n([\s\S]*?)```/g, (_, b) =>
    hold(`<div class="mt-2 flex flex-col gap-2">${b.trim().split("\n").map(replayFileCard).join("")}</div>`),
  );
  t = t.replace(/```\w*\n([\s\S]*?)```/g, (_, b) => hold(`<pre class="my-1 overflow-hidden rounded-lg bg-foreground/[0.04] px-3 py-2 text-[12px] leading-[1.5]">${esc(b.trimEnd())}</pre>`));
  const para = (p) => {
    const lines = p.split("\n");
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l)))
      return `<ul class="flex flex-col gap-0.5 pl-1">${lines.map((l) => `<li class="flex gap-2"><span class="text-muted-foreground">•</span><span>${inlineMd(l.replace(/^\s*([-*]|\d+\.)\s/, ""))}</span></li>`).join("")}</ul>`;
    if (lines.every((l) => l.trim().startsWith("|"))) {
      const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|"));
      return `<table class="w-full text-[13px]">${rows.map((r, i) => `<tr class="${i ? "border-t border-border" : "font-medium"}">${r.map((c) => `<td class="py-1 pr-3">${inlineMd(c.trim())}</td>`).join("")}</tr>`).join("")}</table>`;
    }
    return lines.map(inlineMd).join("<br>");
  };
  return t
    .trim()
    .split(/\n{2,}/)
    .map((p) => (/^\u0000\d+\u0000$/.test(p.trim()) ? p.trim() : `<div>${para(p)}</div>`))
    .join("")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
};

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const took = (s) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)}s`);
const firstSentence = (s) => (s.replace(/```[\s\S]*?```/g, "").replace(/`/g, "").trim().split(/(?<=\.)\s/)[0] || "").slice(0, 120);

/** A task's card as the records have it at time T: the step it's on while it runs, then what it made, flat and gray. */
const replayTaskCard = (task, T) => {
  const done = T >= task.doneAt;
  const now = task.steps.filter((s) => s.t <= T).at(-1);
  const text = done ? (task.files.length ? `Made ${task.files.map(baseName).join(" and ")}` : firstSentence(task.summary)) : now ? now.label : "Starting";
  const time = done ? took(task.doneAt - task.start) : took(Math.max(0, T - task.start));
  const tone = done ? "done" : "run";
  const file = done && task.files[0];
  return `
  <div class="w-[520px] max-w-full overflow-hidden rounded-[14px] ${done ? "bg-[light-dark(#f1f0ed,#232321)]" : "bg-[light-dark(#ffffff,#262624)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06]"}">
    <div class="flex items-center gap-3 py-2.5 pr-2.5 pl-3.5">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-[13px] leading-5 font-medium text-foreground">${esc(text)}</span>
        <span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">${DOT[tone]}<span class="truncate">${esc(task.name)}</span><span class="text-foreground/25">·</span><span class="shrink-0 tabular-nums">${time}</span></span>
      </div>
      ${file ? `<span class="grid h-11 w-9 shrink-0 place-items-center rounded-[5px] bg-white text-[18px] shadow-xs ring-1 ring-black/[0.08]">${fileMark(extOf(file), "text-[18px]")}</span>` : ""}
    </div>
  </div>`;
};

/** The chat asking to use an app, while it waits on you. */
const askCard = (ask) => `
  <div class="w-[520px] max-w-full rounded-[14px] bg-[light-dark(#fffaf0,#2a2418)] p-3 pl-3.5 ring-1 ring-warning-500/35">
    <div class="flex items-center gap-2 text-[13px] font-medium">${DOT.wait}Instrument wants to use ${esc(ask.target || "an app")}</div>
    <div class="mt-1 text-[13px] text-foreground/75">${esc(ask.reason)}</div>
    <div class="mt-2.5 flex gap-1.5">${pillDark("Allow")}${pillSoft("Don't allow")}</div>
  </div>`;

/** Every moment something changes, in order, with the line the scrubber shows for it. */
const EVENTS = (() => {
  const c = TL.chat;
  const ev = [
    ...c.you.map((y) => ({ t: y.t, kind: "you", text: `You: ${y.text}` })),
    ...c.says.map((s) => ({ t: s.t, kind: "says", text: `Instrument: ${firstSentence(s.text) || s.text.slice(0, 100)}` })),
    ...c.steps.map((s) => ({ t: s.t, kind: s.ask ? "ask" : s.startsTask ? "task" : "step", text: s.ask ? `Asks to use ${s.ask.target}` : s.startsTask ? `Starts a task: ${s.startsTask}` : `Step: ${s.label}` })),
    ...c.errors.map((e, i) => ({ t: e.t, kind: "error", text: `A request to the model failed (${i + 1} of ${c.errors.length}), so it tries again` })),
    ...TL.tasks.flatMap((k) => [
      ...k.steps.map((s) => ({ t: s.t, kind: "taskstep", text: `${k.name}: ${s.label}` })),
      ...(k.doneAt != null ? [{ t: k.doneAt, kind: "taskdone", text: `${k.name} finished` }] : []),
    ]),
  ];
  return ev.sort((a, b) => a.t - b.t);
})();

/** The chat at time T: its list row, then the transcript up to that moment, its own work inline and each task in a card. */
const replayView = (T) => {
  const c = TL.chat;
  const lastWake = Math.max(-1, ...c.you.filter((y) => y.t <= T).map((y) => y.t), ...c.wakes.filter((w) => w.t <= T).map((w) => w.t));
  const lastStop = Math.max(-1, ...c.stops.filter((s) => s <= T));
  const busy = lastWake > lastStop;
  const items = [
    ...c.you.filter((y) => y.t <= T).map((y) => ({ t: y.t, o: 0, kind: "you", y })),
    ...c.says.filter((s) => s.t <= T).map((s) => ({ t: s.t, o: 1, kind: "says", s })),
    ...c.steps.filter((s) => s.t <= T).map((s) => ({ t: s.t, o: 2, kind: "step", s })),
  ].sort((a, b) => a.t - b.t || a.o - b.o);

  const out = [];
  let run = [];
  let label = "";
  const flush = (isLast) => {
    if (!run.length) return;
    const live = isLast && busy;
    const asking = run.find((s) => s.ask && s.t <= T && s.end > T);
    if (live && !asking) out.push(fresh(working(esc(run.at(-1).label)), "w-fit max-w-full"));
    else if (!live || asking) {
      const steps = run.map((s) => [s.ask ? "hand" : s.startsTask ? "arrow-bend-down-right" : "terminal-window", esc(s.label), took(s.end - s.t)]);
      const key = String(run[0].t);
      out.push(`<div data-fold="${key}" class="w-fit cursor-pointer">${workedLine(run.length === 1 ? esc(run[0].label) : `${esc(run[0].label)} and ${run.length - 1} more`, { steps, open: OPEN.has(key) })}</div>`);
    }
    if (asking) out.push(askCard(asking.ask));
    for (const s of run.filter((x) => x.task)) {
      const task = TL.tasks.find((k) => k.id === s.task);
      if (task) out.push(replayTaskCard(task, T));
    }
    label = run.at(-1).label;
    run = [];
  };
  items.forEach((it, i) => {
    if (it.kind === "step") return run.push(it.s);
    flush(false);
    out.push(it.kind === "you" ? you(esc(it.y.text)) : says(md(it.s.text)));
  });
  const endsOnSteps = run.length > 0;
  flush(true);
  const failed = c.errors.filter((e) => e.t > lastWake && e.t <= T);
  const spoke = items.some((it) => it.t > lastWake && it.kind !== "you");
  const idle = failed.length && !spoke ? `Couldn't reach the model, trying again (try ${failed.length + 1})` : "Thinking";
  if (busy && !endsOnSteps) out.push(working(idle));
  const nowLabel = busy ? (endsOnSteps ? label : idle) : "";
  const lastSays = c.says.filter((s) => s.t <= T).at(-1);
  const asking = c.steps.find((s) => s.ask && s.t <= T && s.end > T);
  const list = inboxCol({
    on: 0,
    rows: [
      { title: REPLAY.chat, preview: lastSays ? firstSentence(lastSays.text) : "", step: asking ? "" : nowLabel, ask: asking ? `Wants to use ${asking.ask.target}` : "", working: busy && !asking, time: "Now", holds: [] },
      ...ROWS.slice(1, 4),
    ],
  }).replace("ph ph-warning-circle shrink-0 text-[14px]", "ph ph-question shrink-0 text-[15px]");
  const transcript = `
    <div class="relative flex min-w-0 flex-1 flex-col">
      ${head(REPLAY.chat)}
      <div class="flex min-h-0 flex-1 flex-col justify-end overflow-hidden"><div class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-4 pb-2">${turnMeta({ when: "Today" })}${out.join("")}</div></div>
      <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${replyBox({})}</div>
    </div>`;
  return appWindow({ bar: winBar({ tabs: [{ chats: true, title: REPLAY.chat }] }), body: list + transcript });
};

const TICK = { you: "bg-foreground h-3.5", says: "bg-foreground/30 h-2.5", step: "bg-foreground/30 h-2.5", ask: "bg-warning-500 h-3.5", task: "bg-brand-600 h-3.5", taskstep: "bg-brand-400 h-2", taskdone: "bg-brand-600 h-3.5", error: "bg-[#d14b3f] h-3.5" };
const captionAt = (T) => (EVENTS.filter((e) => e.t <= T).at(-1) || { text: "The chat opens" }).text;

/** The scrubber under the screen: play, the timeline with a tick per event and a bar per task, the time, what just happened, and the speed. */
const scrubber = (T) => {
  const D = TL.duration;
  const pct = (t) => `${((t / D) * 100).toFixed(2)}%`;
  const ticks = EVENTS.map((e) => `<span class="absolute bottom-1/2 w-[2px] translate-y-1/2 rounded-full ${TICK[e.kind]}" style="left:${pct(e.t)}"></span>`).join("");
  const bars = TL.tasks.map((k) => `<span class="absolute top-0 h-1 rounded-full bg-brand-500/45" style="left:${pct(k.start)};width:${pct((k.doneAt ?? k.end) - k.start)}"></span>`).join("");
  const fails = TL.chat.errors.length ? `<span class="absolute top-0 h-1 rounded-full bg-[#d14b3f]/40" style="left:0;width:${pct(TL.chat.errors.at(-1).t)}"></span>` : "";
  return `
  <div class="flex h-[84px] items-center gap-4 border-t border-border bg-background px-5">
    <button data-replay-play title="Play (Space)" class="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background"><i class="ph ph-play text-[16px]"></i></button>
    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <div class="flex items-center gap-3 text-[13px]"><span data-replay-caption class="min-w-0 flex-1 truncate text-foreground/85">${esc(captionAt(T))}</span><span data-replay-time class="shrink-0 tabular-nums text-muted-foreground">${clock(T)} / ${clock(D)}</span></div>
      <div class="relative h-7">
        <div class="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-foreground/15"></div>
        <div class="pointer-events-none absolute inset-0">${bars}${fails}${ticks}</div>
        <input data-replay type="range" min="0" max="${D}" step="0.1" value="${T}" class="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent accent-foreground" aria-label="Time in the chat" />
      </div>
    </div>
    <button data-replay-speed title="Speed" class="flex h-8 shrink-0 items-center rounded-lg bg-foreground/[0.06] px-2.5 text-[12px] font-medium tabular-nums">1×</button>
  </div>`;
};

const META = { title: REPLAY.title, line: REPLAY.line, source: REPLAY.source };

let T = REPLAY.at;
const SCREEN = { w: 1280, h: 800, draw: () => replayView(T), controls: () => scrubber(T) };

// The scrubber's behavior: drag it, use ← and → to jump from one event to the next, Space to play, and click a
// folded line of steps to open it. Only the screen and the scrubber's words are redrawn as time moves, so the slider
// under your pointer is never replaced mid-drag.
if (typeof document !== "undefined") {
  const SPEEDS = [1, 4, 16];
  let speed = 1;
  let timer = null;
  const $ = (sel) => document.querySelector(sel);
  const show = (t) => {
    T = Math.max(0, Math.min(TL.duration, t));
    $("#screen").innerHTML = replayView(T);
    $("[data-replay]").value = String(T);
    $("[data-replay-caption]").textContent = captionAt(T);
    $("[data-replay-time]").textContent = `${clock(T)} / ${clock(TL.duration)}`;
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    $("[data-replay-play] i").className = "ph ph-play text-[16px]";
  };
  const play = () => {
    if (timer) return stop();
    if (T >= TL.duration) show(0);
    $("[data-replay-play] i").className = "ph ph-pause text-[16px]";
    timer = setInterval(() => {
      show(T + 0.1 * speed);
      if (T >= TL.duration) stop();
    }, 100);
  };
  const jump = (dir) => {
    const next = dir > 0 ? EVENTS.find((x) => x.t > T + 0.05) : EVENTS.filter((x) => x.t < T - 0.05).at(-1);
    show(next ? next.t : dir > 0 ? TL.duration : 0);
  };
  document.addEventListener("input", (e) => {
    if (e.target.matches?.("[data-replay]")) show(Number(e.target.value));
  });
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      jump(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === " " && !e.target.closest?.("button")) {
      e.preventDefault();
      play();
    }
  });
  document.addEventListener("click", (e) => {
    const fold = e.target.closest?.("[data-fold]");
    if (fold) {
      const key = fold.dataset.fold;
      OPEN.has(key) ? OPEN.delete(key) : OPEN.add(key);
      return show(T);
    }
    if (e.target.closest?.("[data-replay-play]")) return play();
    const speedBtn = e.target.closest?.("[data-replay-speed]");
    if (speedBtn) {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
      speedBtn.textContent = `${speed}×`;
    }
  });
}
