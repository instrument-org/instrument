// ---- a chat ---------------------------------------------------------------------
// A chat beside the inbox (chat-screen.tsx): its head, transcript, tiles, pane and reply
// box, and the cards that sit over the box. The transcript's look is under active
// redesign, so these stay deliberately plain: draw a proposal's own transcript with
// `thread({ body })` rather than growing these.

/**
 * The chat header (chat-header.tsx): 56px, three columns with the outer two equally wide
 * (`side`, 96 by default; widen it when `right` needs the room) so the title stands in
 * the middle. At the left the inbox toggle, or `left`; in the middle the title with its
 * caret (the chat's menu) and, under it, the one line saying where the chat's work
 * stands (`line`, from statusLine), which also opens its tasks; at the right the pop-out,
 * then `right`. `align: "left"` stands the title at the left after the toggle instead.
 * `project` (a PROJECTS name) puts the chat's project pill after its title.
 */
const threadHead = (title, { right = "", line = "", left, side = 96, align = "center", popOut = true, project = "" } = {}) => {
  const toggle = left ?? `<span class="grid size-8 shrink-0 place-items-center text-foreground/50"><i class="ph ph-sidebar-simple text-[16px]"></i></span>`;
  const name = `<span class="flex h-8 min-w-0 max-w-full items-center gap-1 text-sm font-medium"><span class="truncate">${title}</span><i class="ph ph-caret-down shrink-0 text-[12px] text-muted-foreground"></i>${project ? `<span class="ml-1">${projectPill(project, { quiet: false })}</span>` : ""}</span>`;
  const ends = `${popOut ? `<span class="grid size-8 shrink-0 place-items-center text-foreground/50"><i class="ph ph-picture-in-picture text-[16px]"></i></span>` : ""}${right}`;
  if (align === "left")
    return `
  <div class="flex h-12 shrink-0 items-start gap-2 bg-background px-3 pt-2">
    <div class="flex h-8 items-center">${toggle}</div>
    <div class="flex min-w-0 flex-1 flex-col items-start">${name}${line ? `<div class="-mt-1 flex h-4 max-w-full min-w-0">${line}</div>` : ""}</div>
    <div class="flex h-8 items-center justify-end gap-x-1">${ends}</div>
  </div>`;
  return `
  <div class="grid h-14 shrink-0 items-start gap-x-2 bg-background px-3 pt-2" style="grid-template-columns:${side}px minmax(0,1fr) ${side}px">
    <div class="flex h-8 items-center">${toggle}</div>
    <div class="flex min-w-0 flex-col items-center">${name}<div class="-mt-1 flex h-4 max-w-full min-w-0 justify-center">${line}</div></div>
    <div class="flex h-8 items-center justify-end gap-x-1">${ends}</div>
  </div>`;
};

/** The line under a chat's title (chat-status-line.tsx), 12px: while it works the planning dot and the step in the shimmer; `tone` "done" for the muted check, "wait" for the amber question, "failed" for the red warning. */
const statusLine = (text, { tone = "run" } = {}) => {
  const mark = {
    run: planningDot,
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


/** Where the transcript starts: when the chat began and the model that answered, centered and small. */
const turnMeta = ({
  when = "Today 9:41 AM",
  model = "Auto",
  mark = "instrumentglyph",
} = {}) =>
  `<div class="flex items-center justify-center gap-1.5 pb-1 text-[12px] text-muted-foreground"><span>${when}</span><span>·</span>${brand(mark, "size-3.5 opacity-70")}<span>${model}</span></div>`;

const you = (text) =>
  `<div class="flex justify-end"><div class="max-w-[80%] rounded-2xl rounded-tr-md bg-[light-dark(#bcdcd2,#1f4a41)] px-3.5 py-2 text-sm text-foreground">${text}</div></div>`;
const agent = (text) =>
  `<div class="max-w-[85%] rounded-2xl rounded-tl-md bg-card px-3.5 py-2 text-sm leading-[1.5]">${text}</div>`;

/** A file the agent linked, as the transcript's file card: its picture on a small page, the name, and its kind under it. */
const FILE_KINDS = { html: "HTML", csv: "CSV", md: "Markdown", pdf: "PDF" };
const fileRow = (key) => `
  <div class="flex w-90 max-w-[85%] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"><span class="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-white shadow-xs ring-1 ring-border">${fileMark(FILES[key].kind)}</span><span class="flex min-w-0 flex-col"><span class="truncate text-sm">${FILES[key].title}</span><span class="text-[12px] text-muted-foreground">${FILE_KINDS[FILES[key].kind]}</span></span></div>`;

/** A page the agent opened, as a thin row in the transcript. */
const pageRow = (site) => `
  <div class="flex max-w-[85%] items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px]">${SITES[site].mark()}<span class="truncate">${SITES[site].title}</span></div>`;

/** The plus that opens the reply box's menu: a 28px round on the stone ground. */
const plusButton = `<span class="grid size-7 shrink-0 place-items-center rounded-full bg-gray-100"><i class="ph ph-plus text-[16px] text-foreground/60"></i></span>`;

/** The mic and the send arrow at the reply box's end. */
const replyEnds = `<span class="grid size-7 shrink-0 place-items-center text-foreground/55"><i class="ph ph-microphone text-[16px]"></i></span><span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>`;

/** The reply box: the plus, the words (or "Talk to Instrument"), the mic and the arrow. */
const replyBox = ({ ph = "Talk to Instrument", text = "" } = {}) => `
  <div class="flex items-center gap-2 rounded-[22px] bg-[light-dark(#ffffff,#262624)] p-1.5 shadow-sm">
    ${plusButton}
    <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
    ${replyEnds}
  </div>`;

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
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${head || threadHead(title, { line: working ? statusLine(working) : "", project })}
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden ${stick === "bottom" ? "justify-end" : ""}"><div class="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4">${body}</div></div>
    <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${tiles}${foot}${replyEl || replyBox(reply)}</div>
  </div>`;

/** One of a chat's tiles: its picture at the tile's width, hung from the top, its mark on a badge at the picture's lower left, and its name under it at the tile's whole width. `on` rings the one shown large and sets it, name in the foreground ink, on the rail's lit-place plate; a page an agent drives has its name in the brand color (the app's shimmer). `icon` draws a tile with no picture: that icon large in the box, and no badge. */
const chatTile = (t, { on = false, icon = "" } = {}) => `
  <div class="flex w-24 shrink-0 flex-col gap-1.5 ${on ? "-m-1.5 box-content rounded-xl bg-foreground/[0.08] p-1.5" : ""}">
    <div class="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-card shadow-xs ${on ? "ring-2 ring-foreground/70" : "ring-1 ring-border/70"}">${
      icon
        ? `<div class="grid h-full place-items-center">${icon}</div>`
        : `<div class="absolute top-0 left-0 origin-top-left scale-[0.25]" style="width:400%;height:400%">${page(t)}</div><span class="absolute bottom-1 left-1 grid size-4 place-items-center rounded-sm bg-white/85">${tabMark(t, "size-3 text-[6px]")}</span>`
    }</div>
    <span class="truncate px-0.5 text-[11px] leading-4 ${on ? "font-medium text-foreground" : t.agent ? "text-brand-600" : "text-muted-foreground"}">${tabTitle(t)}</span>
  </div>`;

/** A chat's tiles in a row over its reply box (thread's `tiles`): one per thing it holds, oldest first, then New. `active` is the one shown large, -1 for none. Past the column's width the row pages with a round arrow over a fade at each end it runs past (`more`: \"right\", \"left\" or \"both\"). */
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

/** The pane beside a chat, flush with a border: its location row, ending in the × that puts it away, and the page. The chat's tiles are over its reply box, not here. */
const paneCard = ({ tab, body, w = 560, loc = true }) => `
  <div class="flex shrink-0 flex-col border-l border-border" style="width:${w}px">
    ${loc ? locRow(tab, { close: true }) : ""}
    <div class="relative min-h-0 flex-1 overflow-hidden">${body ?? page(tab)}</div>
  </div>`;

/**
 * The popover the line under a chat's title opens (measured 2026-10-16): a white card
 * about 320 wide hanging just under the line, its rows grouped under small labels
 * ("Running", "Finished"), each a mark, the task's name and how long ago at the right.
 * `groups` are [label, [[name, age, done]]]. Place it with `left` and `top`.
 */
const statusPop = (groups, { left, top, w = 320 } = {}) => `
  <div class="absolute z-30 rounded-xl border border-border bg-white p-1.5 shadow-lg" style="left:${left}px;top:${top}px;width:${w}px">
    ${groups
      .map(
        ([label, rows]) =>
          `<div class="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">${label}</div>${rows
            .map(
              ([name, age, done]) =>
                `<div class="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px]">${done ? `<i class="ph ph-check text-[14px] text-muted-foreground"></i>` : planningDot}<span class="min-w-0 flex-1 truncate ${done ? "text-foreground/80" : ""}">${name}</span><span class="text-[11px] text-muted-foreground tabular-nums">${age}</span></div>`,
            )
            .join("")}`,
      )
      .join("")}
  </div>`;

/** A step row in the transcript as built: a pale slate band with a dashed blue rule at its left, the tool's glyph in a small box, the step, and the eye that shows its detail. `icon` is a Phosphor name (terminal-window for a command, globe for a page). */
const stepRow = (text, { icon = "terminal-window", done = false } = {}) =>
  `<div class="flex h-7 items-center gap-2 rounded-r-md border-l-2 border-dashed border-blue-300 bg-slate-100/80 pr-2 pl-2 text-[13px] text-muted-foreground"><span class="grid size-5 place-items-center rounded bg-slate-200/70"><i class="ph ph-${done ? "check-circle" : icon} text-[12px]"></i></span><span class="min-w-0 flex-1 truncate">${text}</span><i class="ph ph-eye text-[14px] text-blue-400"></i></div>`;

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
 * The question card the agent's choose call draws (debug/components/question): the
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
