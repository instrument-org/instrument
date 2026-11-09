// ---- a chat ---------------------------------------------------------------------
// A chat beside the inbox (routes/_app/route.tsx, chat-header.tsx, task/chat.tsx,
// transcript/), re-measured 2026-11-07: a 48px head with the title at the left, then one
// transcript column of turns (the person's tinted bubble, the agent's plain words, a
// line per activity, the task card and the live card), and the reply box at the foot.
// Nothing sits under the title any more and there are no tiles over the box: a chat's
// tabs show only in the pane beside it, across its head.

/** The inbox toggle at a head's left (inbox-toggle.tsx): a 28px ghost button. */
const inboxToggle = `<span class="grid size-7 shrink-0 place-items-center text-muted-foreground/70"><i class="ph ph-sidebar-simple text-[16px]"></i></span>`;

/** The pane toggle at a head's right (pane-toggle.tsx): "Show tabs", lit while the pane is up (`on`). */
const paneToggle = (on = false) =>
  `<span class="grid size-7 shrink-0 place-items-center rounded-md ${on ? "bg-accent text-foreground" : "text-muted-foreground/70"}"><i class="ph ph-browsers text-[16px]"></i></span>`;

/** The "+ Project" slot a new chat's head and a draft's head have while no project is picked (project-picker.tsx). */
const addProjectChip = `<span class="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground"><i class="ph ph-plus text-[12px]"></i>Project</span>`;

/** The project a new chat or a draft will be filed under (compose-window.tsx ProjectSlot): "in", then the tinted pill with its × . */
const projectSlot = (project) => {
  if (!project) return addProjectChip;
  const t = typeof project === "string" ? projectByName(project) : project;
  return `<span class="flex min-w-0 items-center gap-1"><span class="shrink-0 text-[13px] text-muted-foreground">in</span><span class="inline-flex h-5 min-w-0 items-center rounded-full bg-(--project-tint-surface) text-[11px] leading-4 text-foreground/90" style="${projectTint(t.color)}"><span class="flex h-full min-w-0 items-center gap-1 pr-0.5 pl-1"><span class="text-[10px]">${t.emoji}</span><span class="max-w-28 truncate">${t.name}</span></span><span class="grid h-full w-5 shrink-0 place-items-center text-foreground/60"><i class="ph ph-x text-[9px]"></i></span></span></span>`;
};

/**
 * The chat header (chat-header.tsx): 48px, the inbox toggle (or `left`), then the title
 * and its caret (pressing the title renames the chat, the caret opens its menu), the
 * project pill after them, and at the right the pane toggle (`pane` lights it) then
 * `right`. `popOut` draws the pop-out glyph after the title, which the app shows only
 * under the pointer. `line` puts a proposal's own line under the title; the app has
 * none. `align: "center"` still draws the earlier centered head, for a proposal that
 * argues for it.
 */
const threadHead = (title, { right = "", line = "", left, side = 96, align = "left", popOut = false, project = "", pane = false, toggle: showToggle = true } = {}) => {
  const toggle = left ?? (showToggle ? inboxToggle : "");
  const name = `<span class="-mx-1.5 flex h-8 max-w-96 min-w-0 items-center text-sm font-medium"><span class="min-w-0 truncate pr-0.5 pl-1.5">${title}</span><span class="grid h-8 shrink-0 place-items-center pr-1.5 pl-0.5"><i class="ph ph-caret-down text-[12px] text-muted-foreground"></i></span></span>`;
  const pill = project ? projectPill(project, { quiet: false }) : "";
  const pop = popOut ? `<span class="grid size-7 shrink-0 place-items-center text-muted-foreground/70"><i class="ph ph-picture-in-picture text-[16px]"></i></span>` : "";
  const ends = `${paneToggleOrNone(pane)}${right}`;
  if (align === "center")
    return `
  <div class="grid h-14 shrink-0 items-start gap-x-2 bg-background px-3 pt-2" style="grid-template-columns:${side}px minmax(0,1fr) ${side}px">
    <div class="flex h-8 items-center">${toggle}</div>
    <div class="flex min-w-0 flex-col items-center"><span class="flex h-8 min-w-0 max-w-full items-center gap-2">${name}${pill}</span><div class="-mt-1 flex h-4 max-w-full min-w-0 justify-center">${line}</div></div>
    <div class="flex h-8 items-center justify-end gap-x-1">${ends}</div>
  </div>`;
  return `
  <div class="flex ${line ? "h-14 items-start pt-2" : "h-12 items-center"} w-full min-w-0 shrink-0 gap-x-2 bg-background ${toggle ? "pl-3" : "pl-4"} pr-3">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-8 min-w-0 items-center gap-x-1">${toggle}<div class="flex min-w-0 flex-1 items-center gap-x-2">${name}${pill}${pop}</div></div>
      ${line ? `<div class="-mt-1 flex h-4 max-w-full min-w-0 ${toggle ? "pl-8" : ""}">${line}</div>` : ""}
    </div>
    <div class="flex h-8 shrink-0 items-center gap-x-1">${ends}</div>
  </div>`;
};
const paneToggleOrNone = (pane) => (pane === null ? "" : paneToggle(pane));

/** A line in a chat's step colors (run, done, wait, failed), with the working mark while it runs. The app no longer draws a status line under the title; this is for a proposal that puts one back (threadHead's `line`). */
const statusLine = (text, { tone = "run" } = {}) => {
  const mark = {
    run: workingMark,
    done: `<i class="ph ph-check text-[14px] text-muted-foreground"></i>`,
    wait: `<i class="ph ph-question text-[14px] text-warning-700"></i>`,
    failed: `<i class="ph ph-warning-circle text-[14px] text-error-700"></i>`,
  }[tone];
  const color = {
    run: "text-brand-600",
    done: "text-muted-foreground",
    wait: "text-foreground/80",
    failed: "text-error-700",
  }[tone];
  return `<span class="flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] leading-5">${mark}<span class="min-w-0 truncate ${color}">${text}</span></span>`;
};

/** The agent at work (icons/working-mark.tsx): one green dot, 10px across, breathing in a 20px box with a faint ring. */
const workingMark = `<span class="relative grid size-5 shrink-0 place-items-center"><span class="absolute size-4 rounded-full bg-[radial-gradient(circle,rgba(95,174,147,0.38),transparent_70%)]"></span><span class="absolute size-[18px] rounded-full border-[1.5px] border-[rgba(95,174,147,0.35)]"></span><span class="relative size-2.5 rounded-full bg-[#1f8a6a]"></span></span>`;

/** Where a turn starts (chat-separator.tsx): the day, the time and the model, centered, small and faint. */
const turnMeta = ({
  when = "Today 9:41 AM",
  model = "Auto",
  mark = "instrumentglyph",
} = {}) => {
  const [day, ...time] = when.split(" ");
  return `<div class="flex items-center justify-center gap-1.5 pt-1.5 pb-1 text-xs text-muted-foreground opacity-50"><span><span class="font-medium">${day}</span> ${time.join(" ")}</span><span>·</span><span class="flex items-center gap-1">${brand(mark, "size-3.5")}<span>${model}</span></span></div>`;
};

/** What the person sent (user-message.tsx): a bubble at the right in the brand's pale tint, its corner nearest the reply squared off. */
const you = (text) =>
  `<div class="flex justify-end pb-2"><div class="max-w-[80%] rounded-2xl rounded-br-md bg-[light-dark(#b9d9cd,#1f4a41)] px-3.5 py-2 text-sm text-foreground">${text}</div></div>`;
/** What the agent said (assistant-message.tsx): plain words the column's width, at 15px. */
const agent = (text) => `<div class="reply w-full text-[15px] leading-[1.5]">${text}</div>`;

/** Under a reply once its turn is done (assistant-messages-footer.tsx): copy, then how long it took, Sources with their favicons, the model and when, split by mid-dots. The app shows it on hover, or always under the last reply. */
const replyFoot = ({ took = "1m 12s", sources = [], model = "Auto", when = "9:43 AM" } = {}) => {
  const items = [
    took && `<span>${took}</span>`,
    sources.length && `<span class="flex items-center gap-1.5">Sources<span class="flex items-center gap-1">${sources.map((s) => SITES[s].mark("size-3.5 text-[7px]")).join("")}</span></span>`,
    model && `<span class="flex items-center gap-1">${brand("instrumentglyph", "size-3.5 opacity-70")}${model}</span>`,
    when && `<span>${when}</span>`,
  ].filter(Boolean);
  return `<div class="mt-2 flex items-center gap-2"><span class="grid size-6 place-items-center text-muted-foreground"><i class="ph ph-copy text-[14px]"></i></span><span class="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">${items.join(`<span>·</span>`)}</span></div>`;
};

/**
 * One line of a turn's work (transcript/activity-row.tsx RowLine), 28px: a 20px mark,
 * the label in the muted ink, the sites it reached, a count or clock, and the caret that
 * opens its calls. `live` swaps the mark for the working dot, sets the label in the
 * brand's shimmer, puts the clock after it, and draws `explanation` (the call going on)
 * under it. `icon` is a Phosphor name for the last call's tool.
 */
const activityRow = (label, { icon = "terminal-window", live = false, clock = "0:42", count = "", sites = [], explanation = "", open = false, done = false } = {}) => {
  const mark = live
    ? workingMark
    : `<span class="grid size-5 shrink-0 place-items-center rounded-lg bg-black/5"><i class="ph ph-${done ? "check" : icon} text-[12px] text-foreground/70"></i></span>`;
  const right = [count && `<span class="text-foreground/70">${count}</span>`, live && clock && `· ${clock}`].filter(Boolean).join(" ");
  return `<div class="flex min-w-0 flex-col"><div class="flex h-7 max-w-full min-w-0 items-center gap-2 text-sm">${mark}<span class="min-w-0 truncate ${live ? "text-brand-600" : "text-muted-foreground"}">${label}</span>${sites.length ? `<span class="flex shrink-0 items-center gap-0.5">${sites.map((s) => SITES[s].mark("size-3.5 text-[7px]")).join("")}</span>` : ""}${right ? `<span class="flex shrink-0 items-center text-xs text-muted-foreground tabular-nums">${right}</span>` : ""}${live && !open ? "" : `<i class="ph ph-caret-right shrink-0 text-[12px] text-muted-foreground ${open ? "rotate-90" : ""}"></i>`}</div>${live && explanation ? `<span class="ml-7 block truncate text-xs text-muted-foreground">${explanation}</span>` : ""}</div>`;
};

/** A finished turn's work folded into one line (turn-view.tsx WorkedRow): a check in the mark's box, "Worked for 2m" or the turn's summary, the sites it reached, and the caret. */
const workedRow = (label = "Worked for 2m", { sites = [] } = {}) => activityRow(label, { done: true, sites });

/** "Thinking" while no call runs (turn-view.tsx ThinkingRow), with its clock. */
const thinkingRow = (clock = "0:04") =>
  `<div class="flex h-7 items-center gap-2 text-sm">${workingMark}<span class="text-brand-600">Thinking</span><span class="text-xs text-muted-foreground tabular-nums">· ${clock}</span></div>`;

/** The old name for a line of work, drawn now as the activity row (`done` folds it to the check). */
const stepRow = (text, { icon = "terminal-window", done = false } = {}) => activityRow(text, { icon, done });

/**
 * A task the chat started (transcript/task-card.tsx), at most 460 wide: its step, a dot
 * trail or the check, and the sites it reached on the first line; "Task · <title> · <how
 * long>" under it. `working` tints it with a brand edge and sets the step in the
 * shimmer; finished it sits flat on the muted ground. `failed` swaps the check for the
 * amber warning. `card` hangs the task's live card under it while it works.
 */
const taskCard = ({ line = "Reading plans on zendesk.com", title = "Competitor pricing pages", span = "2 min", working = true, failed = false, sites = [], card = "" } = {}) => `
  <div class="flex max-w-115 flex-col gap-2">
    <div class="flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 ${working ? "border-brand-600/40 bg-brand-500/10" : "border-transparent bg-muted/60"}">
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-1.5"><span class="min-w-0 truncate text-sm ${working ? "text-brand-600" : "text-foreground"}">${line}</span>${
          working
            ? `<span class="flex shrink-0 items-center gap-0.5 text-brand-600">${`<span class="size-1 rounded-full bg-current"></span>`.repeat(3)}</span>`
            : failed
              ? `<i class="ph ph-warning shrink-0 text-[14px] text-warning-600"></i>`
              : `<i class="ph ph-check shrink-0 text-[14px] text-muted-foreground"></i>`
        }${sites.length ? `<span class="flex shrink-0 items-center gap-0.5">${sites.map((s) => SITES[s].mark("size-3.5 text-[7px]")).join("")}</span>` : ""}</span>
        <span class="block truncate text-xs text-muted-foreground tabular-nums">Task · ${title}${span ? ` · ${span}` : ""}</span>
      </span>
    </div>
    ${card}
  </div>`;

/**
 * The live card (transcript/work-card.tsx): what the work is on right now, under the
 * activity it belongs to (indented 28px, `indent`) or under a task card. A 460-wide
 * card, a 208px picture of the page, file or search over a 32px foot naming it with
 * its mark, and `meta` at the right. `current` rings it with the brand's glint while
 * the work goes on. `tab` draws the picture from a page or file; `body` replaces it.
 */
const liveCard = ({ tab = { site: "zendesk" }, body, title, mark, meta = "", current = true, indent = false } = {}) => `
  <div class="relative w-full max-w-115 rounded-2xl ${indent ? "ml-7" : ""}">
    <div class="overflow-hidden rounded-2xl border border-border bg-card">
      <div class="relative h-52 overflow-hidden bg-muted/50">${body ?? `<div class="absolute top-0 left-0 origin-top-left scale-[0.5]" style="width:200%;height:200%">${page(tab)}</div>`}</div>
      <div class="flex h-8 items-center gap-1.5 border-t border-border px-2.5 text-xs"><span class="flex size-4 shrink-0 items-center justify-center text-muted-foreground">${mark ?? (tab.site ? `<i class="ph ph-globe text-[14px]"></i>` : `<i class="ph ph-file-text text-[14px]"></i>`)}</span><span class="min-w-0 truncate text-foreground/80">${title ?? tabTitle(tab)}</span>${meta ? `<span class="ml-auto shrink-0 pl-2 text-muted-foreground tabular-nums">${meta}</span>` : ""}</div>
    </div>
    ${current ? `<span class="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-brand-500/35"></span>` : ""}
  </div>`;

/** A file the agent linked, as the transcript's file card: its picture on a small page, the name, and its kind under it. */
const FILE_KINDS = { html: "HTML", csv: "CSV", md: "Markdown", pdf: "PDF" };
const fileRow = (key) => `
  <div class="flex w-90 max-w-[85%] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"><span class="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-white shadow-xs ring-1 ring-border">${fileMark(FILES[key].kind)}</span><span class="flex min-w-0 flex-col"><span class="truncate text-sm">${FILES[key].title}</span><span class="text-[12px] text-muted-foreground">${FILE_KINDS[FILES[key].kind]}</span></span></div>`;

/** A file the agent named in a narrow column (agent-files-block.tsx FileLine): a 32px line with the file's mark, its name, its kind and an arrow out. */
const fileLine = (key) =>
  `<div class="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2 text-xs">${fileMark(FILES[key].kind, "text-[15px]")}<span class="min-w-0 flex-1 truncate">${FILES[key].title}</span><span class="shrink-0 text-[10px] text-muted-foreground">${KIND_TEXT[FILES[key].kind] ?? ""}</span><i class="ph ph-arrow-up-right shrink-0 text-[12px] text-muted-foreground"></i></div>`;

/** A page the agent opened, as a thin row in the transcript. */
const pageRow = (site) => `
  <div class="flex max-w-[85%] items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px]">${SITES[site].mark()}<span class="truncate">${SITES[site].title}</span></div>`;

/** The plus that opens the reply box's menu: a 28px round on the stone ground. */
const plusButton = `<span class="grid size-7 shrink-0 place-items-center rounded-full bg-gray-100"><i class="ph ph-plus text-[16px] text-foreground/60"></i></span>`;

/** The mic and the send arrow at the reply box's end. */
const replyEnds = `<span class="grid size-7 shrink-0 place-items-center text-foreground/55"><i class="ph ph-microphone text-[16px]"></i></span><span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>`;

/** The reply box (composer-frame.tsx, the pill): the plus, the words (or "Talk to Instrument"), the mic and the arrow. `chips` (composerChip and offerChip) sit in a row over the words. */
const replyBox = ({ ph = "Talk to Instrument", text = "", chips = "" } = {}) => `
  <div class="flex flex-col rounded-[22px] bg-[light-dark(#ffffff,#262624)] p-1.5 shadow-sm">
    ${chips ? `<div class="flex flex-wrap items-center gap-1 px-1 pb-1.5">${chips}</div>` : ""}
    <div class="flex items-center gap-2">
      ${plusButton}
      <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
      ${replyEnds}
    </div>
  </div>`;

/**
 * A chat column: the head, the transcript in its 768px column with 16px between turns,
 * then `foot` (a card or a note over the box) and the reply box. `working` adds a live
 * activity row naming that step at the transcript's end, where the app says the chat is
 * at work; `stick: "bottom"` sits a long transcript on the box. `pane` lights the head's
 * pane toggle. `tiles` is kept for proposals: the app has no tile row.
 */
const thread = ({
  title = PRICING_TITLE,
  body = pricing(2),
  working = "",
  tiles = "",
  head = "",
  foot = "",
  reply = {},
  replyEl = "",
  stick = "top",
  project = "",
  pane = false,
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${head || threadHead(title, { project, pane })}
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden ${stick === "bottom" ? "justify-end" : ""}"><div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-8">${body}${working ? activityRow(working, { live: true, explanation: "" }) : ""}</div></div>
    <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${tiles}${foot}${replyEl || replyBox(reply)}</div>
  </div>`;

/**
 * A new chat beside the list (window/new-chat-view.tsx): a chat's head saying "New
 * chat" with the project slot after it (`project` fills it) and the pane toggle, an
 * empty room (or, in a project, its mark, name and where new chats go), and the pill
 * composer saying "What do you need?". `chips` are the draft's composer chips;
 * `foot` draws a note over the box (modelProblem's floating `replyNote`).
 */
const newChat = ({ project = "", text = "", chips = "", foot = "", room = false, pane = false } = {}) => {
  const t = project ? (typeof project === "string" ? projectByName(project) : project) : null;
  return `
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-12 w-full min-w-0 shrink-0 items-center gap-x-2 bg-background pr-3 pl-3">
      <div class="flex h-8 min-w-0 flex-1 items-center gap-x-1">${inboxToggle}<span class="min-w-0 truncate text-sm font-medium">New chat</span><span class="ml-1 flex min-w-0">${projectSlot(project)}</span></div>
      <div class="flex h-8 shrink-0 items-center gap-x-1">${paneToggle(pane)}</div>
    </div>
    <div class="grid min-h-0 flex-1 place-items-center overflow-hidden px-6">${
      t && room
        ? `<div class="flex flex-col items-center pb-16 text-center" style="${projectTint(t.color)}"><span class="grid size-12 place-items-center rounded-xl bg-background text-[22px] shadow-xs ring-1 ring-border/60">${t.emoji}</span><h3 class="mt-3 text-xl font-semibold text-(--project-tint-ink)">${t.name}</h3><p class="mt-1 text-sm text-muted-foreground">New chats here go into ${t.name}.</p></div>`
        : ""
    }</div>
    <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${foot}${replyBox({ ph: "What do you need?", text, chips })}</div>
  </div>`;
};

/** One of a chat's tiles, as the app drew them before e4eced2b1 took the tile row out. Kept for proposals that argue for tiles again. */
const chatTile = (t, { on = false, icon = "" } = {}) => `
  <div class="flex w-24 shrink-0 flex-col gap-1.5 ${on ? "-m-1.5 box-content rounded-xl bg-foreground/[0.08] p-1.5" : ""}">
    <div class="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-card shadow-xs ${on ? "ring-2 ring-foreground/70" : "ring-1 ring-border/70"}">${
      icon
        ? `<div class="grid h-full place-items-center">${icon}</div>`
        : `<div class="absolute top-0 left-0 origin-top-left scale-[0.25]" style="width:400%;height:400%">${page(t)}</div><span class="absolute bottom-1 left-1 grid size-4 place-items-center rounded-sm bg-white/85">${tabMark(t, "size-3 text-[6px]")}</span>`
    }</div>
    <span class="truncate px-0.5 text-[11px] leading-4 ${on ? "font-medium text-foreground" : t.agent ? "text-brand-600" : "text-muted-foreground"}">${tabTitle(t)}</span>
  </div>`;

/** A row of tiles over a reply box (thread's `tiles`), as the app had them; the app now shows a chat's tabs only in its pane (paneCard). */
const rowEnd = (side) =>
  `<div class="pointer-events-none absolute inset-y-0 ${side === "left" ? "left-0 justify-start bg-gradient-to-r pl-1" : "right-0 justify-end bg-gradient-to-l pr-1"} flex w-16 items-start from-background via-background/80 to-transparent pt-6"><span class="grid size-7 place-items-center rounded-full bg-background text-foreground shadow-md ring-1 ring-border"><i class="ph ph-caret-${side} text-[13px]"></i></span></div>`;
const chatTiles = (tabs, active = -1, { more = "" } = {}) => `
  <div class="relative mb-2">
    <div class="flex items-start gap-2 overflow-hidden p-0.5">
      ${tabs.map((t, i) => chatTile(t, { on: i === active })).join("")}
      <div class="flex h-18 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-medium text-muted-foreground"><i class="ph ph-plus text-[16px]"></i>New</div>
    </div>
    ${more === "left" || more === "both" ? rowEnd("left") : ""}${more === "right" || more === "both" ? rowEnd("right") : ""}
  </div>`;

/**
 * A chat's tabs across the head of its pane (window/pane-tabs.tsx): the window's own
 * tab strip in its scrolling mode, every tab at its name's width, the one up on the
 * pane's white card; then + (Browser, This Mac) and the × that hides the pane.
 */
const paneTabs = (tabs, active = 0) => `
  <div class="flex h-10 shrink-0 items-center gap-1 pr-2 pl-2" style="--color-background:var(--color-card)">
    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">${tabs
      .map((t, i) => `<div class="flex shrink-0" style="width:${Math.min(240, 56 + tabTitle(t).length * 7)}px">${barTab(t, { on: i === active, sep: i !== active && i + 1 !== active && i + 1 < tabs.length })}</div>`)
      .join("")}</div>
    <span class="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground/70"><i class="ph ph-plus text-[16px]"></i></span>
    <span class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground"><i class="ph ph-x text-[16px]"></i></span>
  </div>`;

/** The pane beside a chat (routes/_app/route.tsx), flush with a hairline at its left: the chat's tabs (`tabs`, `active`; just `tab` when there is one), the tab's location row, and the page. */
const paneCard = ({ tab, tabs, active, body, w = 560, loc = true }) => {
  const all = tabs ?? [tab];
  const up = active ?? Math.max(0, all.indexOf(tab));
  const shown = all[up] ?? tab;
  return `
  <div class="flex shrink-0 flex-col overflow-hidden border-l border-border" style="width:${w}px">
    ${paneTabs(all, up)}
    ${loc ? locRow(shown, { close: true }) : ""}
    <div class="relative min-h-0 flex-1 overflow-hidden">${body ?? page(shown)}</div>
  </div>`;
};

/** The popover the line under a chat's title opened, before c17f71ff2 took the list of a chat's tasks out. Kept for proposals; the app shows a chat's tasks as task cards in its transcript. */
const statusPop = (groups, { left, top, w = 320 } = {}) => `
  <div class="absolute z-30 rounded-xl border border-border bg-white p-1.5 shadow-lg" style="left:${left}px;top:${top}px;width:${w}px">
    ${groups
      .map(
        ([label, rows]) =>
          `<div class="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">${label}</div>${rows
            .map(
              ([name, age, done]) =>
                `<div class="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px]">${done ? `<i class="ph ph-check text-[14px] text-muted-foreground"></i>` : workingMark}<span class="min-w-0 flex-1 truncate ${done ? "text-foreground/80" : ""}">${name}</span><span class="text-[11px] text-muted-foreground tabular-nums">${age}</span></div>`,
            )
            .join("")}`,
      )
      .join("")}
  </div>`;

/**
 * A permission card over the reply box (permission-asks.tsx): "Can Instrument use this
 * folder?" (`kind` folder | app | tab) over what it asks for in a muted well (`name`,
 * `path`), then Allow in this chat, Always allow and Don't allow. `more` draws the
 * cards waiting behind it and "1 of n".
 */
const permissionCard = ({ kind = "folder", name = "Documents", path = "mac-user › Documents", more = 0 } = {}) => `
  <div class="relative mb-2 ${more ? "pb-2" : ""}">
    ${more > 1 ? `<div class="absolute inset-x-6 bottom-0 h-6 rounded-b-2xl border border-border bg-card/70"></div>` : ""}${more ? `<div class="absolute inset-x-3 bottom-1 h-6 rounded-b-2xl border border-border bg-card shadow-xs"></div>` : ""}
    <div class="relative rounded-2xl border border-border bg-card p-3 shadow-xs">
      <div class="flex items-start justify-between gap-3"><p class="text-sm font-medium">Can Instrument use this ${kind}?</p>${more ? `<span class="text-xs text-muted-foreground">1 of ${more + 1}</span>` : ""}</div>
      <div class="mt-2.5 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2"><span class="grid size-8 shrink-0 place-items-center">${kind === "folder" ? fileMark("folder", "text-[22px]") : kind === "tab" ? `<i class="ph ph-globe text-[20px] text-muted-foreground"></i>` : brand("gmail", "size-5")}</span><span class="flex min-w-0 flex-1 flex-col"><span class="truncate text-sm">${name}</span>${path ? `<span class="truncate text-xs text-muted-foreground">${path}</span>` : ""}</span></div>
      <div class="mt-3 flex items-center gap-2">${kind === "tab" ? button("Move tab here", { tone: "brand", size: "sm" }) : button("Allow in this chat", { tone: "brand", size: "sm" }) + button("Always allow", { tone: "outline", size: "sm" })}<span class="ml-auto">${button(kind === "tab" ? "Skip" : "Don’t allow", { tone: "ghost", size: "sm", cls: "text-muted-foreground" })}</span></div>
    </div>
  </div>`;

/**
 * The question card the agent's choose call draws (message-part/tool-choose.tsx): the
 * question, its choices as radio rows (a choice is a label or [label, line]), "Something
 * else..." to write your own, then Add a note, Skip and Send. `pick` is the chosen
 * index; `steps` (labels) draws the tabs of several questions over it, `step` the one up.
 */
const questionCard = ({ question = "Which team size should I compare prices at?", choices = [["10 agents", "Where most of your customers are"], ["25 agents", "Where Zendesk's tiers change"], "50 agents"], pick = -1, steps = [], step = 0 } = {}) => `
  <div class="mb-2 rounded-2xl bg-card p-4 shadow-xs ring-1 ring-border">
    ${steps.length ? `<div class="-mx-2 -mt-2 mb-3 flex items-center gap-1 border-b border-border pb-2 text-[13px]">${steps.map((l, i) => `<span class="rounded-md px-2 py-1 ${i === step ? "bg-foreground/6 font-medium" : "text-muted-foreground"}">${l === "Review" ? "" : `<span class="mr-1.5 text-muted-foreground">${i + 1}</span>`}${l}</span>`).join("")}</div>` : ""}
    <p class="mb-2 text-sm font-medium">${question}</p>
    ${choices
      .map((c, i) => {
        const [label, line] = Array.isArray(c) ? c : [c, ""];
        return `<div class="flex items-start gap-3 py-1.5">${radio(i === pick)}<span class="-mt-0.5 flex flex-col"><span class="text-sm">${label}</span>${line ? `<span class="text-xs text-muted-foreground">${line}</span>` : ""}</span></div>`;
      })
      .join("")}
    <div class="flex items-start gap-3 py-1.5">${radio(false)}<span class="-mt-0.5 text-sm text-muted-foreground">Something else...</span></div>
    <div class="mt-2 flex items-center gap-2 text-[13px]"><span class="flex-1 text-muted-foreground">Add a note</span><span class="text-muted-foreground">Skip</span><span class="flex h-7 items-center gap-1 rounded-lg px-2.5 font-medium text-white ${pick >= 0 ? "bg-brand-600" : "bg-brand-600/45"}">Send<i class="ph ph-arrow-up text-[12px]"></i></span></div>
  </div>`;

/** A question card once answered (tool-choose.tsx AnsweredCard): each question's answer in full, words typed by the person in quotes, and the caret that opens every choice. */
const answeredCard = (rows = [["Team size", "10 agents"]]) => `
  <div class="rounded-[20px] bg-card ring-1 ring-border">
    <div class="flex flex-col gap-1 p-3.5 text-[13px]">${rows
      .map(([q, a], i) => `<span class="flex w-full items-start gap-2"><i class="ph ph-check mt-0.5 text-[14px] text-brand-600"></i><span class="w-28 shrink-0 truncate text-muted-foreground">${q}</span><span class="min-w-0 flex-1 font-medium">${a}</span>${i === 0 ? `<i class="ph ph-caret-down ml-auto self-center text-[12px] text-muted-foreground"></i>` : ""}</span>`)
      .join("")}</div>
  </div>`;
