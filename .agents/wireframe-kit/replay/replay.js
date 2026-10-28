// ---- the replay: one chat's records, drawn in the design at any moment, as a prototype with a scrubber under it
// build-replay.mjs puts this after the design's pieces, with TL (the timeline from records-to-timeline.mjs) and
// REPLAY ({ title, chat, at, line, source }) defined above it. From the design it needs says, working, workedLine,
// head, DOT, pillDark, pillSoft, shimmerText, miniDot, taskHeader and chatBrief; the rest is the kit's.

/** The step runs opened in the transcript, by when their first step started. */
const OPEN = new Set();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inlineMd = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, `<code class="rounded bg-foreground/[0.06] px-1 text-[12.5px]">$1</code>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, `<span class="text-brand-700 underline decoration-brand-700/30 underline-offset-2">$1</span>`);
const baseName = (p) => p.replace(/^workspace:/, "").split("/").pop();
const extOf = (p) => (p.split(".").pop() || "").toLowerCase();

/** A file's mark: the kit's for the kinds it draws, and a plain document for the rest. */
const markFor = (p) => ({ html: 1, htm: 1, md: 1, csv: 1, pdf: 1 })[extOf(p)] ? fileMark(extOf(p) === "htm" ? "html" : extOf(p)) : `<i class="ph ph-file text-[15px] text-muted-foreground"></i>`;

/** A file the chat linked, as the transcript's file card, with its own kind's mark. */
const replayFileCard = (p) =>
  `<div class="flex w-90 max-w-[85%] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"><span class="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-white shadow-xs ring-1 ring-border">${markFor(p)}</span><span class="flex min-w-0 flex-col"><span class="truncate text-sm">${esc(baseName(p))}</span><span class="text-[12px] text-muted-foreground">${esc(extOf(p).toUpperCase())}</span></span></div>`;

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
    .map((p) => (/^\u0000\d+\u0000$/.test(p.trim()) ? `<div class="mb-3 last:mb-0">${p.trim()}</div>` : `<div class="mb-3 last:mb-0">${para(p)}</div>`))
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

/**
 * A step's label on a line that sums it up, where it sits and changes as you watch: the live working line, the folded
 * line, the chat's row and a task card. That's the activity, which calls running together share, so the line holds
 * still while they run. The list a line opens onto names each call by its own explanation (`label`).
 */
const summaryOf = (s) => s.activity || s.label;

/** A step's icon: what kind of work it was. */
const stepIcon = (s) =>
  s.ask ? "hand" : s.choose ? "list-checks" : s.startsTask ? "arrow-bend-down-right" : s.uses ? "browser" : s.tool === "web_search" ? "magnifying-glass" : s.tool === "web_fetch" ? "globe" : "terminal-window";

/** The chat's words as far as they've streamed in at T: whole words, in proportion to how far through its span it is. */
const streamed = (said, T) => {
  if (T >= said.end || said.end <= said.t) return said.text;
  const shown = Math.floor(said.text.length * Math.max(0, (T - said.t) / (said.end - said.t)));
  const cut = said.text.lastIndexOf(" ", shown);
  return said.text.slice(0, cut > 0 ? cut : shown);
};

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const took = (s) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)}s`);
const firstSentence = (s) => (s.replace(/```[\s\S]*?```/g, "").replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1").replace(/`/g, "").trim().split(/(?<=\.)\s/)[0] || "").slice(0, 120);

/** A task's card as the records have it at time T: the step it's on while it runs, then what it made, flat and gray. */
const replayTaskCard = (task, T) => {
  const done = T >= task.doneAt;
  const now = task.steps.filter((s) => s.t <= T).at(-1);
  const text = done ? (task.files.length ? `Made ${task.files.map(baseName).join(" and ")}` : firstSentence(task.summary)) : now ? summaryOf(now) : "Starting";
  const time = done ? took(task.doneAt - task.start) : took(Math.max(0, T - task.start));
  const tone = done ? "done" : "run";
  const file = done && task.files[0];
  return `
  <div data-task-open="${task.id}" class="w-[520px] max-w-full cursor-pointer overflow-hidden rounded-[14px] ${VIEW.pane && VIEW.tab === task.id ? "ring-2 ring-brand-500/35 " : ""}${done ? "bg-[light-dark(#f1f0ed,#232321)]" : "bg-[light-dark(#ffffff,#262624)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06]"}">
    <div class="flex items-center gap-3 py-2.5 pr-2.5 pl-3.5">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 font-medium text-foreground">${done ? DOT.done : miniDot()}<span class="truncate">${done ? esc(text) : shimmerText(esc(text))}</span></span>
        <span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground"><span class="truncate">${esc(task.name)}</span><span class="text-foreground/25">·</span><span class="shrink-0 tabular-nums">${time}</span></span>
      </div>
      ${file ? `<span class="grid h-11 w-9 shrink-0 place-items-center rounded-[5px] bg-white text-[18px] shadow-xs ring-1 ring-black/[0.08]">${markFor(file)}</span>` : ""}
    </div>
  </div>`;
};

/**
 * A question the chat put to you, drawn as the app draws it (QuestionCard in apps/studio's tool-choose.tsx): a plain
 * tool card with the question, the choices as rows with a ring each, a row to type your own answer, and Add a note
 * and Skip under them. Once answered it's the same card, the rows no longer clickable, your pick tinted with its ring
 * filled and checked, and any note under them as a quote.
 */
const chooseCard = (c, T) => {
  const answer = c.answer && T >= c.answeredAt ? c.answer : null;
  const open = !answer;
  const picked = answer?.selectedChoice?.trim();
  const ring = (on) =>
    on
      ? `<span aria-hidden class="grid size-4.5 shrink-0 place-items-center rounded-full border border-brand-600 bg-brand-600 text-white"><i class="ph ph-check text-[11px]"></i></span>`
      : `<span aria-hidden class="grid size-4.5 shrink-0 place-items-center rounded-full border border-foreground/25"></span>`;
  const row = (text, on) =>
    `<div class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm ${on ? "bg-brand-500/10 text-foreground" : open ? "text-foreground" : "text-muted-foreground"}">${ring(on)}<span class="min-w-0 flex-1">${esc(text)}</span></div>`;
  const own = picked && !c.choices.some((x) => x.trim() === picked);
  const rows = [
    ...c.choices.map((x) => row(x, x.trim() === picked)),
    ...(open ? [`<div class="flex w-full items-center gap-2.5 rounded-lg py-1 pr-1 pl-2 text-left text-sm">${ring(false)}<span class="min-w-0 flex-1 py-0.5 text-muted-foreground">Something else…</span><span class="size-6"></span></div>`] : own ? [row(picked, true)] : []),
  ];
  const foot = open
    ? `<div class="-mx-2.5 mt-2 flex items-center justify-between gap-2"><span class="flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-muted-foreground">Add a note</span><span class="flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-muted-foreground">Skip</span></div>`
    : `${answer?.declined ? `<p class="mt-3 text-xs text-muted-foreground">You skipped this question.</p>` : ""}${answer?.note ? `<p class="mt-3 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">${esc(answer.note)}</p>` : ""}`;
  return `
  <div class="mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card">
    <div class="px-4 py-3">
      <p class="mb-2 text-sm font-medium text-pretty">${esc(c.question)}</p>
      <div class="-mx-2 flex flex-col gap-0.5">${rows.join("")}</div>${foot}
    </div>
  </div>`;
};

/**
 * Words the chat says around a question card that only announce it: a one-line lead-in in the same call ("Asking which
 * tone you want.") and anything between putting the card up and getting the answer ("I've put the tone question on a
 * card."). The card says it all, so the replay leaves them out, standing in for a change to the choose tool's prompt.
 */
const narratesACard = (said) =>
  TL.chat.steps.some(
    (q) =>
      q.choose?.question &&
      ((q.end <= said.t && said.t < (q.choose.answeredAt ?? Infinity)) ||
        // A one-line lead-in written in the same call as the question ("Asking which tone you want.") only announces
        // the card; anything longer before a question can be worth saying, so it stays.
        (q.call && said.call === q.call && !said.text.trim().includes("\n") && said.text.trim().length <= 90)),
  );

/** A call that asks you something, which the transcript draws as its card rather than as a step. */
const asksYou = (s) => Boolean(s.ask || s.choose?.question || s.tool === "connect_app");

/** Whether an ask is up at T: from when the chat asked until you answered, or to the end if you never did. */
const askOpen = (s, T) => s.ask && s.t <= T && !(s.ask.answeredAt != null && T >= s.ask.answeredAt);

/**
 * A folder or app the chat asks to use, drawn as the app draws it (permission-asks.tsx): a plain card just above the
 * reply box, with the question, the chat's reason, what it wants in a muted row, and Allow in this chat, Always allow
 * and Don't allow. It's never in the transcript: one place above the reply box keeps several from piling up, and a
 * task's ask has no call of the chat's to sit under.
 */
const askCard = (ask) => {
  const name = ask.target.split("/").filter(Boolean).pop() || "an app";
  const folder = ask.kind === "folder";
  const what = folder
    ? `<span class="grid size-8 shrink-0 place-items-center">${fileMark("folder", "text-[22px]")}</span><span class="flex min-w-0 flex-1 flex-col"><span class="truncate text-sm">${esc(name)}</span><span class="truncate text-xs text-muted-foreground">~/${esc(name)}</span></span>`
    : `<span class="grid size-8 shrink-0 place-items-center"><i class="ph ph-app-window text-[20px] text-muted-foreground"></i></span><span class="min-w-0 flex-1 truncate text-sm">${esc(name)}</span>`;
  const button = (label, cls) => `<span class="flex h-8 items-center rounded-lg px-3 text-[13px] font-medium ${cls}">${label}</span>`;
  return `
  <div class="mb-2 rounded-2xl border border-border bg-card p-3 shadow-xs">
    <p class="text-sm font-medium">Can Instrument use this ${folder ? "folder" : "app"}?</p>
    ${ask.reason ? `<p class="mt-0.5 text-[13px] text-muted-foreground">${esc(ask.reason)}</p>` : ""}
    <div class="mt-2.5 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2">${what}</div>
    <div class="mt-3 flex items-center gap-2">${button("Allow in this chat", "bg-brand-600 text-white")}${button("Always allow", "border border-border bg-background")}${button("Don’t allow", "ml-auto text-muted-foreground")}</div>
  </div>`;
};

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
    ...c.says.filter((s) => !narratesACard(s)).map((s) => ({ t: s.t, kind: "says", text: `Instrument: ${firstSentence(s.text) || s.text.slice(0, 100)}` })),
    ...c.steps.map((s) => ({ t: s.t, kind: s.ask || s.choose ? "ask" : s.startsTask ? "task" : "step", text: s.ask ? `Asks to use ${s.ask.target.split("/").filter(Boolean).pop()}` : s.choose ? `Asks you: ${s.choose.question}` : s.startsTask ? `Starts ${s.startsTasks.length > 1 ? `${s.startsTasks.length} tasks` : "a task"}: ${s.startsTasks.join(", ")}` : `Step: ${s.label}` })),
    ...c.steps.filter((s) => s.choose?.answer).map((s) => ({ t: s.choose.answeredAt, kind: "you", text: `You pick ${s.choose.answer.selectedChoice ?? "an answer"}${s.choose.answer.note ? `: “${s.choose.answer.note}”` : ""}` })),
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
const VIEW = { pane: false, list: true, tab: null, tasks: [] };


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

/**
 * A task's tab, as the app draws it (task-page.tsx): its name over how long it has run, counting up, and Stop while it
 * works; what the chat asked it; then its own transcript, drawn the way the chat's is. There's nothing to type into: you
 * talk to the chat, which talks to the task.
 */
const taskTabBody = (task, T) => {
  // The task is at work until its own last record, not until the chat hears it's done, which comes a moment later.
  const ended = Math.min(task.doneAt ?? Infinity, task.end);
  const running = T < ended;
  const { html } = transcriptOf(task, T, { busy: running && T >= task.start, lastWake: task.start, withTasks: false });
  return `
  ${taskHeader(esc(task.name), { running, time: took(Math.max(0, Math.min(T, ended) - task.start)) })}
  <div data-task-transcript class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
    <div class="flex flex-col gap-4 px-5 pt-5 pb-6">${task.brief ? chatBrief(esc(task.brief)) : ""}${html}</div>
  </div>`;
};

/**
 * The pane: the tasks you've opened from their cards, then the chat's own tabs. The one picked shows, else the newest
 * task opened, else the page in use, else the newest page; a page glows while Instrument uses it.
 */
const replayPane = (T, tabs, usingId) => {
  const tasks = VIEW.tasks.map((id) => TL.tasks.find((k) => k.id === id)).filter((k) => k && k.start <= T);
  const ids = [...tasks.map((k) => k.id), ...tabs.map((t) => t.id)];
  const activeId = ids.includes(VIEW.tab) ? VIEW.tab : tasks.at(-1)?.id ?? (ids.includes(usingId) ? usingId : tabs.at(-1)?.id);
  const task = tasks.find((k) => k.id === activeId);
  const page = tabs.find((t) => t.id === activeId);
  const body = task
    ? taskTabBody(task, T)
    : page.id === usingId
      ? usedPage({ url: page.url, html: page.page })
      : `${addressRow(page.url)}<div class="relative min-h-0 flex-1 overflow-hidden">${page.page}</div>`;
  const taskTabs = tasks.map((k) => `<span data-tab="${k.id}" class="flex min-w-0 shrink cursor-pointer">${pageTab(T < k.doneAt ? miniDot() : DOT.done, esc(k.name), { on: k.id === activeId })}</span>`).join("");
  const pageTabs = tabs.map((t) => `<span data-tab="${t.id}" class="flex min-w-0 shrink cursor-pointer">${pageTab(siteMark(t), esc(t.title), { on: t.id === activeId, agent: t.id === usingId, using: t.id === usingId })}</span>`).join("");
  return `
  <div class="relative flex shrink-0 flex-col bg-background p-2 pl-0" style="width:680px">
    <div class="flex min-h-0 flex-1 flex-col rounded-xl bg-[light-dark(#f5f5f4,#1c1c1a)] p-1.5">
      <div class="flex h-9 shrink-0 items-center gap-1 pb-1.5">
        ${taskTabs}${taskTabs && pageTabs ? `<span class="mx-1 h-4 w-px shrink-0 bg-foreground/15"></span>` : ""}${pageTabs}
        <span class="grid size-7 shrink-0 place-items-center text-foreground/55"><i class="ph ph-plus text-[14px]"></i></span>
        <span class="flex-1"></span><span data-pane-close class="cursor-pointer">${iconBtn("x")}</span>
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background shadow-xs">${body}</div>
    </div>
  </div>`;
};

/**
 * A session's transcript at T, the chat's or a task's alike, since the app draws a task's tab with the chat's own
 * transcript (ChatStream in child-tasks.tsx): its words streaming in, its steps folding into a line once done, the live
 * line while it works, and the cards that ask you something. `busy` and `lastWake` say whether it's at work and since
 * when; `withTasks` draws the cards of the tasks it started.
 */
const transcriptOf = (sess, T, { busy, lastWake, withTasks = true }) => {
  const items = [
    ...sess.you.filter((y) => y.t <= T).map((y) => ({ t: y.t, o: 0, kind: "you", y })),
    ...sess.says.filter((s) => s.t <= T && !narratesACard(s)).map((s) => ({ t: s.t, o: 1, kind: "says", s })),
    // A call that asks you something (a question, a folder or app, a sign-in) is drawn as its card alone, the way the
    // app's ToolCallBody draws it, since the card is the whole of what there is to read; it never joins a run of steps.
    // A card shows once it has been put up, when its call is done, not while the chat is still writing it: until then
    // the chat is at work and its working line says so.
    ...sess.steps
      .filter((s) => (asksYou(s) ? s.end : s.t) <= T)
      .map((s) => ({ t: asksYou(s) ? s.end : s.t, o: 2, kind: asksYou(s) ? "card" : "step", s })),
  ].sort((a, b) => a.t - b.t || a.o - b.o);

  const out = [];
  let run = [];
  let label = "";
  const flush = (isLast) => {
    if (!run.length) return;
    // Live only if its steps belong to the turn under way: a turn a finished task woke has nothing to do with them.
    const live = isLast && busy && run.some((x) => x.t >= lastWake);
    const key = `${sess.id}:${run[0].t}`;
    // A step that started tasks gives way to their cards: the card is the record of starting it.
    // It goes the moment the first of its tasks exists, even if the call is still finishing, so a card takes the
    // line's place rather than showing under it and then jumping up when the line goes.
    const shown = run.filter((x) => !(withTasks && x.tasks?.some((id) => (TL.tasks.find((k) => k.id === id)?.start ?? Infinity) <= T)));
    if (!shown.length) {
      // Nothing left to draw as a step: the cards below say it all.
    } else if (live) {
      // The line under way opens too, onto what it's done so far and what's still running.
      const open = OPEN.has(key);
      const rows = shown.map(
        (s) =>
          `<div class="flex min-h-7 items-center gap-2 text-[13px] text-muted-foreground">${s.end <= T ? `<i class="ph ph-${stepIcon(s)} shrink-0 text-[13px]"></i>` : `<i class="ph ph-circle-notch shrink-0 animate-spin text-[13px] text-brand-600"></i>`}<span class="min-w-0 truncate">${esc(s.label)}</span><span class="shrink-0 text-foreground/25">·</span><span class="shrink-0 text-[12px] tabular-nums text-muted-foreground/70">${s.end <= T ? took(s.end - s.t) : "running"}</span></div>`,
      );
      // Between calls nothing is running: the model is working out its next one, which is where most of the time
      // goes. A last row says so, so the list never looks finished while the line above it is still at work.
      const lastEnd = Math.max(...shown.map((s) => s.end));
      if (shown.every((s) => s.end <= T))
        rows.push(
          `<div class="flex min-h-7 items-center gap-2 text-[13px] text-brand-700"><i class="ph ph-circle-notch shrink-0 animate-spin text-[13px] text-brand-600"></i><span class="min-w-0 truncate">Thinking</span><span class="shrink-0 text-foreground/25">·</span><span class="shrink-0 text-[12px] tabular-nums text-muted-foreground/70">${took(T - lastEnd)}</span></div>`,
        );
      out.push(
        `<div class="flex flex-col"><div data-fold="${key}" class="w-fit cursor-pointer">${liveWorking(summaryOf(shown.at(-1)), { open })}</div>${open ? `<div class="mt-1 ml-[9px] flex flex-col gap-0.5 border-l border-border pl-4">${rows.join("")}</div>` : ""}</div>`,
      );
    } else {
      const steps = shown.map((s) => [stepIcon(s), esc(s.label), took(s.end - s.t)]);
      out.push(`<div data-fold="${key}" class="w-fit cursor-pointer">${workedLine(shown.length === 1 ? esc(summaryOf(shown[0])) : `${esc(summaryOf(shown[0]))} and ${shown.length - 1} more`, { steps, open: OPEN.has(key) })}</div>`);
    }
    // The tasks a run started stack as one set, close together, rather than spaced like separate parts of the reply.
    const cards = run
      .flatMap((x) => x.tasks ?? [])
      .map((id) => TL.tasks.find((k) => k.id === id))
      .filter((k) => k && k.start <= T)
      .map((task) => replayTaskCard(task, T));
    if (withTasks && cards.length) out.push(`<div class="flex flex-col gap-1.5">${cards.join("")}</div>`);
    label = summaryOf(run.at(-1));
    run = [];
  };
  items.forEach((it, i) => {
    if (it.kind === "step") return run.push(it.s);
    if (it.kind === "card") {
      flush(false);
      if (it.s.choose?.question) out.push(chooseCard(it.s.choose, T));
      return;
    }
    flush(false);
    out.push(it.kind === "you" ? you(esc(it.y.text)) : says(md(streamed(it.s, T))));
  });
  const endsOnSteps = run.length > 0 && run.some((x) => x.t >= lastWake);
  flush(true);
  const failed = sess.errors.filter((e) => e.t > lastWake && e.t <= T);
  const spoke = items.some((it) => it.t > lastWake && it.kind !== "you");
  const idle = failed.length && !spoke ? `Couldn't reach the model, trying again (try ${failed.length + 1})` : "Thinking";
  // Words arriving are the chat at work, so there's no Thinking line under them while they stream.
  const writing = sess.says.some((x) => x.t <= T && T < x.end && !narratesACard(x));
  if (busy && !endsOnSteps && !writing) out.push(liveWorking(idle));
  return { html: out.join(""), label: busy ? (endsOnSteps ? label : idle) : "" };
};

/** The chat at time T: its list row, then the transcript up to that moment, its own work inline and each task in a card. */
const replayView = (T) => {
  const c = TL.chat;
  const lastWake = Math.max(-1, ...c.you.filter((y) => y.t <= T).map((y) => y.t), ...c.wakes.filter((w) => w.t <= T).map((w) => w.t));
  const lastStop = Math.max(-1, ...c.stops.filter((s) => s <= T));
  // Once a question card is up the chat is waiting on you, not thinking, unless it goes on to other steps while it
  // waits (more than one thing was asked); the words it wrote about the card in that time are left out (narratesACard).
  const waiting = c.steps.some(
    (q) => q.choose?.question && q.end <= T && T < (q.choose.answeredAt ?? Infinity) && !c.steps.some((s) => s.t > q.end && s.t <= T),
  );
  const busy = lastWake > lastStop && !waiting;
  const { html, label: nowLabel } = transcriptOf(c, T, { busy, lastWake });
  const lastSays = c.says.filter((s) => s.t <= T && !narratesACard(s)).at(-1);
  const asking = c.steps.find((s) => askOpen(s, T));
  const choosing = c.steps.find((s) => s.choose?.question && s.t <= T && !(s.choose.answer && T >= s.choose.answeredAt));
  const list = inboxCol({
    on: 0,
    rows: [
      { title: REPLAY.chat, preview: lastSays ? firstSentence(lastSays.text) : "", step: asking || choosing ? "" : nowLabel, ask: asking ? `Wants to use ${asking.ask.target.split("/").filter(Boolean).pop()}` : choosing ? choosing.choose.question : "", working: busy && !asking && !choosing, time: "Now", holds: [] },
      ...ROWS.slice(1, 4),
    ],
  }).replace("ph ph-warning-circle shrink-0 text-[14px]", "ph ph-question shrink-0 text-[15px]");
  const tabs = tabsAt(T);
  const pane = VIEW.pane && (tabs.length > 0 || VIEW.tasks.some((id) => TL.tasks.find((k) => k.id === id)?.start <= T));
  const right = tabs.length && !pane ? `<span data-pane-open class="cursor-pointer">${tabsPill(tabs, { using: usingAt(T, busy), working: busy })}</span>` : "";
  const transcript = `
    <div class="relative flex min-w-0 flex-1 flex-col">
      ${head(REPLAY.chat, { open: pane, right })}
      <div data-transcript class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"><div class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-4 pb-2">${turnMeta({ when: "Today" })}${html}</div></div>
      <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${c.steps
        .filter((x) => askOpen(x, T))
        .map((x) => askCard(x.ask))
        .join("")}${replyBox({})}</div>
    </div>`;
  return appWindow({
    bar: winBar({ tabs: [{ chats: true, title: REPLAY.chat }] }),
    body: (VIEW.list ? list : "") + transcript + (pane ? replayPane(T, tabs, usingAt(T, busy)) : ""),
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
    const panes = ["[data-transcript]", "[data-task-transcript]"].map((sel) => {
      const was = $(sel);
      return { sel, following: !was || was.scrollHeight - was.scrollTop - was.clientHeight < 8, top: was?.scrollTop ?? 0 };
    });
    $("#screen").innerHTML = replayView(T);
    for (const { sel, following, top } of panes) {
      const now = $(sel);
      if (now) now.scrollTop = following ? now.scrollHeight : top;
    }
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
    const card = e.target.closest?.("[data-task-open]");
    if (card) {
      const id = card.dataset.taskOpen;
      if (!VIEW.tasks.includes(id)) VIEW.tasks.push(id);
      Object.assign(VIEW, { pane: true, list: false, tab: id });
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
