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
    .map((p) => (/^\u0000\d+\u0000$/.test(p.trim()) ? p.trim() : `<div class="mb-3 last:mb-0">${para(p)}</div>`))
    .join("")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
};

/**
 * The app's own working line, moving: the planning dot breathing with its ring traveling out (planning-dot.tsx) and
 * the step in the brand shimmer (reasoning-message.tsx's `brand-shiny-text` with its `ShimmerSweep`), with the app's
 * styles from globals.css in LIVE_CSS. The screen is drawn again every tenth of a second while it plays, which would
 * restart both animations each time, so each starts as far into its loop as the clock already is.
 */
const LIVE_CSS = `
@keyframes planning-dot-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.2); } }
@keyframes planning-dot-shockwave-ring { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(2.5); opacity: 0; } }
@keyframes shimmer-sweep { from { translate: -100% 0; } to { translate: 100% 0; } }
.planning-dot-core { transform-origin: center; animation: planning-dot-breathe 1.5s ease-in-out infinite; animation-delay: var(--live-delay, 0s); }
.planning-dot-shockwave-ring { transform-origin: center; animation: planning-dot-shockwave-ring 1.5s ease-out infinite; animation-delay: var(--live-delay, 0s); pointer-events: none; }
.brand-shiny-text { --shimmer-base: #17604a; --shimmer-glint: #55e8bb; position: relative; display: inline-block; color: var(--shimmer-base); }
.shimmer-sweep { position: absolute; inset: 0; overflow: clip; text-overflow: inherit; color: transparent; pointer-events: none; -webkit-mask-image: linear-gradient(#fff, #fff); mask-image: linear-gradient(#fff, #fff); -webkit-mask-clip: text; }
.shimmer-sweep::before { content: attr(data-text); }
.shimmer-sweep::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 30%, var(--shimmer-glint) 50%, transparent 70%); animation: shimmer-sweep 3s steps(45) infinite; animation-delay: var(--shimmer-delay, 0s); }
@media (prefers-reduced-motion: reduce) { .shimmer-sweep { display: none; } }`;

const liveWorking = (text, { open = null } = {}) => {
  const now = typeof performance === "undefined" ? 0 : performance.now();
  const label = esc(text);
  const caret = open === null ? "" : `<i class="ph ph-caret-${open ? "down" : "right"} shrink-0 text-[11px] text-muted-foreground"></i>`;
  return `<div class="flex h-7 w-fit max-w-full items-center gap-2" style="--live-delay:-${Math.round(now % 1500)}ms">
    <span class="relative isolate inline-grid size-5 shrink-0 place-items-center overflow-visible">
      <span aria-hidden class="planning-dot-shockwave-ring col-start-1 row-start-1 size-2.5 rounded-full border-2 border-brand-400/55"></span>
      <svg class="planning-dot-core relative z-10 col-start-1 row-start-1 size-2.5" fill="none" viewBox="0 0 12 12"><circle cx="6" cy="6" r="6" fill="url(#live-dot)" /><defs><radialGradient id="live-dot" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(6) rotate(90) scale(12)"><stop stop-color="var(--color-brand-600)" /><stop offset="1" stop-color="var(--color-brand-400)" /></radialGradient></defs></svg>
    </span>
    <span class="brand-shiny-text truncate text-sm">${label}<span aria-hidden class="shimmer-sweep" data-text="${label.replace(/"/g, "&quot;")}" style="--shimmer-delay:-${Math.round(now % 3000)}ms"></span></span>${caret}
  </div>`;
};

/** A step's icon: what kind of work it was. */
const stepIcon = (s) =>
  s.ask ? "hand" : s.startsTask ? "arrow-bend-down-right" : s.uses ? "browser" : s.tool === "web_search" ? "magnifying-glass" : s.tool === "web_fetch" ? "globe" : "terminal-window";

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

const hostName = (url) => url.replace(/^\w+:\/\/(www\.)?/, "").split(/[/?#]/)[0];
const siteName = (url) => {
  const parts = hostName(url).split(".");
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
};
const TAB_COLORS = ["#5e6ad2", "#f06a6a", "#0c66e4", "#1f8a5b", "#c2410c", "#7c3aed"];

/** Every moment something changes, in order, with the line the scrubber shows for it. */
const EVENTS = (() => {
  const c = TL.chat;
  const ev = [
    ...c.you.map((y) => ({ t: y.t, kind: "you", text: `You: ${y.text}` })),
    ...c.says.map((s) => ({ t: s.t, kind: "says", text: `Instrument: ${firstSentence(s.text) || s.text.slice(0, 100)}` })),
    ...c.steps.map((s) => ({ t: s.t, kind: s.ask ? "ask" : s.startsTask ? "task" : "step", text: s.ask ? `Asks to use ${s.ask.target}` : s.startsTask ? `Starts a task: ${s.startsTask}` : `Step: ${s.label}` })),
    ...[...new Set(c.tabs.map((k) => k.t))].map((t) => {
      const names = c.tabs.filter((k) => k.t === t).map((k) => siteName(k.url));
      return { t, kind: "tab", text: `Opens ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]} in ${names.length > 1 ? "tabs" : "a tab"}` };
    }),
    ...c.errors.map((e, i) => ({ t: e.t, kind: "error", text: `A request to the model failed (${i + 1} of ${c.errors.length}), so it tries again` })),
    ...TL.tasks.flatMap((k) => [
      ...k.steps.map((s) => ({ t: s.t, kind: "taskstep", text: `${k.name}: ${s.label}` })),
      ...(k.doneAt != null ? [{ t: k.doneAt, kind: "taskdone", text: `${k.name} finished` }] : []),
    ]),
  ];
  return ev.sort((a, b) => a.t - b.t);
})();

/** What the person has open: the pane opens from the tabs button and closes the chat list; `tab` is one they picked. */
const VIEW = { pane: false, list: true, tab: null };


/** The chat's tabs open at T, as the design's tab objects: a title, an address, a mark, and the page or a stand-in for it. */
const tabsAt = (T) =>
  TL.chat.tabs
    .filter((k) => k.t <= T && (k.closed == null || k.closed > T))
    .map((k) => {
      const name = siteName(k.url);
      const title = k.title || `${name} · ${k.url.replace(/^\w+:\/\/[^/]+\/?/, "") || "home"}`;
      const color = TAB_COLORS[TL.chat.tabs.indexOf(k) % TAB_COLORS.length];
      const page = k.picture ? `<img src="${k.picture}" alt="" class="block w-full" />` : docPage({ letter: name[0], color, name, heading: esc(title), dark: false });
      return { id: k.id, url: k.url, title, letter: name[0], color, page, icon: k.icon };
    });

/**
 * The tab Instrument is using at T, which the pane lights up. While the chat is at work and has tabs open, it's using
 * the tab it last touched, as the tabs button says ("Working in 3 tabs"); a step that names several tabs works through
 * them in turn while it runs. Once the chat has finished, it's using none.
 */
const usingAt = (T, busy) => {
  if (!busy) return null;
  const open = new Set(tabsAt(T).map((t) => t.id));
  if (!open.size) return null;
  const step = TL.chat.steps.filter((s) => s.uses?.some((id) => open.has(id)) && s.t <= T).at(-1);
  if (!step) return [...open].at(-1);
  const ids = step.uses.filter((id) => open.has(id));
  const span = Math.max(0.1, step.end + 0.6 - step.t);
  return ids[Math.min(ids.length - 1, Math.floor(((T - step.t) / span) * ids.length))];
};

/** The pane with the chat's tabs: the one picked, else the one in use, else the newest, glowing while Instrument uses it. */
const replayPane = (tabs, usingId) => {
  const active = tabs.find((t) => t.id === VIEW.tab) ?? tabs.find((t) => t.id === usingId) ?? tabs.at(-1);
  const body =
    active.id === usingId
      ? usedPage({ url: active.url, html: active.page })
      : `${addressRow(active.url)}<div class="relative min-h-0 flex-1 overflow-hidden">${active.page}</div>`;
  return `
  <div class="relative flex shrink-0 flex-col bg-background p-2 pl-0" style="width:680px">
    <div class="flex min-h-0 flex-1 flex-col rounded-xl bg-[light-dark(#f5f5f4,#1c1c1a)] p-1.5">
      <div class="flex h-9 shrink-0 items-center gap-1 pb-1.5">
        ${tabs.map((t) => `<span data-tab="${t.id}" class="flex min-w-0 shrink cursor-pointer">${pageTab(siteMark(t), esc(t.title), { on: t.id === active.id, agent: t.id === usingId, using: t.id === usingId })}</span>`).join("")}
        <span class="grid size-7 shrink-0 place-items-center text-foreground/55"><i class="ph ph-plus text-[14px]"></i></span>
        <span class="flex-1"></span><span data-pane-close class="cursor-pointer">${iconBtn("x")}</span>
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background shadow-xs">${body}</div>
    </div>
  </div>`;
};

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
    const key = String(run[0].t);
    if (live && !asking) {
      // The line under way opens too, onto what it's done so far and what's still running.
      const open = OPEN.has(key);
      const rows = run.map(
        (s) =>
          `<div class="flex min-h-7 items-center gap-2 text-[13px] text-muted-foreground">${s.end <= T ? `<i class="ph ph-${stepIcon(s)} shrink-0 text-[13px]"></i>` : `<i class="ph ph-circle-notch shrink-0 animate-spin text-[13px] text-brand-600"></i>`}<span class="min-w-0 flex-1 truncate">${esc(s.label)}</span><span class="shrink-0 text-[12px] text-muted-foreground/70">${s.end <= T ? took(s.end - s.t) : "running"}</span></div>`,
      );
      out.push(
        `<div class="flex flex-col"><div data-fold="${key}" class="w-fit cursor-pointer">${liveWorking(run.at(-1).label, { open })}</div>${open ? `<div class="mt-1 ml-[9px] flex flex-col gap-0.5 border-l border-border pl-4">${rows.join("")}</div>` : ""}</div>`,
      );
    } else {
      const steps = run.map((s) => [stepIcon(s), esc(s.label), took(s.end - s.t)]);
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
  if (busy && !endsOnSteps) out.push(liveWorking(idle));
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
  const tabs = tabsAt(T);
  const pane = VIEW.pane && tabs.length > 0;
  const right = tabs.length && !pane ? `<span data-pane-open class="cursor-pointer">${tabsPill(tabs)}</span>` : "";
  const transcript = `
    <div class="relative flex min-w-0 flex-1 flex-col">
      ${head(REPLAY.chat, { open: pane, right })}
      <div data-transcript class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"><div class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-4 pb-2">${turnMeta({ when: "Today" })}${out.join("")}</div></div>
      <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${replyBox({})}</div>
    </div>`;
  return appWindow({
    bar: winBar({ tabs: [{ chats: true, title: REPLAY.chat }] }),
    body: (VIEW.list ? list : "") + transcript + (pane ? replayPane(tabs, usingAt(T, busy)) : ""),
  });
};

const TICK = { you: "bg-foreground h-3.5", says: "bg-foreground/30 h-2.5", step: "bg-foreground/30 h-2.5", ask: "bg-warning-500 h-3.5", task: "bg-brand-600 h-3.5", taskstep: "bg-brand-400 h-2", taskdone: "bg-brand-600 h-3.5", error: "bg-[#d14b3f] h-3.5", tab: "bg-[#0c66e4] h-3.5" };
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
    <div role="radiogroup" aria-label="Speed" class="flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5 text-[12px] font-medium tabular-nums">${SPEEDS.map((s) => `<button data-replay-speed="${s}" role="radio" aria-checked="${s === 1}" class="h-7 rounded-md px-2.5 text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-xs">${s}×</button>`).join("")}</div>
  </div>`;
};

/** How fast play runs, against the chat's real pace. */
const SPEEDS = [1, 4, 8];

const META = { title: REPLAY.title, line: REPLAY.line, source: REPLAY.source };

let T = 0;
const SCREEN = { w: 1280, h: 800, draw: () => replayView(T), controls: () => scrubber(T) };

// The scrubber's behavior: drag it, use ← and → to jump from one event to the next, Space to play, and click a
// folded line of steps to open it. Only the screen and the scrubber's words are redrawn as time moves, so the slider
// under your pointer is never replaced mid-drag. The transcript reads from the top down, as a chat does, and follows
// the newest message once it runs past the window, unless you've scrolled up to read.
if (typeof document !== "undefined") {
  document.head.append(Object.assign(document.createElement("style"), { textContent: LIVE_CSS }));
  let speed = 1;
  let timer = null;
  const $ = (sel) => document.querySelector(sel);
  const show = (t) => {
    T = Math.max(0, Math.min(TL.duration, t));
    const was = $("[data-transcript]");
    const following = !was || was.scrollHeight - was.scrollTop - was.clientHeight < 8;
    const scrollTop = was?.scrollTop ?? 0;
    $("#screen").innerHTML = replayView(T);
    const now = $("[data-transcript]");
    now.scrollTop = following ? now.scrollHeight : scrollTop;
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
  // The screen answers the press rather than the click: while it plays it's drawn again every tenth of a second, and a
  // click whose press and release straddle a redraw lands on an element that's gone, so it would take several tries.
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const fold = e.target.closest?.("[data-fold]");
    if (fold) {
      const key = fold.dataset.fold;
      OPEN.has(key) ? OPEN.delete(key) : OPEN.add(key);
      return show(T);
    }
    if (e.target.closest?.("[data-pane-open]")) {
      Object.assign(VIEW, { pane: true, list: false });
      return show(T);
    }
    if (e.target.closest?.("[data-pane-close], #screen span:has(> i.ph-browsers)")) {
      Object.assign(VIEW, { pane: false, list: true, tab: null });
      return show(T);
    }
    if (e.target.closest?.("#screen span:has(> i.ph-sidebar-simple)")) {
      VIEW.list = !VIEW.list;
      return show(T);
    }
    const tab = e.target.closest?.("[data-tab]");
    if (tab) {
      VIEW.tab = tab.dataset.tab;
      return show(T);
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-replay-play]")) return play();
    const speedBtn = e.target.closest?.("[data-replay-speed]");
    if (speedBtn) {
      speed = Number(speedBtn.dataset.replaySpeed);
      for (const b of document.querySelectorAll("[data-replay-speed]")) b.setAttribute("aria-checked", String(b === speedBtn));
    }
  });
  // The page draws the screen first, scrolled to the top; open on the newest message, as a chat does.
  requestAnimationFrame(() => {
    const transcript = $("[data-transcript]");
    transcript.scrollTop = transcript.scrollHeight;
  });
}
