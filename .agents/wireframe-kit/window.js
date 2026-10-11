// ---- the window kit ------------------------------------------------------------
// The Studio window, measured off a 1240x840 window on the documents fixture
// (2026-10-01) and redrawn at 1280x800 in the light theme. The bar (40) and the rail
// (76) sit on the gray ground; everything else is one rounded card inset 8px from the
// right and bottom. Chat is the inbox column (320) beside a thread or the empty state;
// a chat's tiles stand in a row over its reply box, and its pane sits flush beside
// it. Tiles, pane and peek re-measured off the documents fixture (2026-10-05); the inbox
// head and rows, the chat head, the location rows, Files' places, the floating chat, the
// draft's head and the plus menu (2026-10-10). Window tabs live in the bar. Onboarding is its own 480x600 window. build.mjs pastes this whole file,
// after brands.js, into the wireframe template's kit section.

const brand = (key, cls = "size-4") =>
  `<img src="${BRAND_URI[key]}" class="${cls} shrink-0" alt="">`;

/** A letter mark for a site with no brand mark in BRAND_URI. Pass finished classes. */
const letterMark = (letter, cls, size = "size-4 text-[9px]") =>
  `<span class="grid ${size} shrink-0 place-items-center rounded-[4px] font-bold text-white ${cls}">${letter}</span>`;

// Sites the pricing thread's task opens. Invented pages and prices, real hosts.
const SITES = {
  zendesk: {
    title: "Suite plans · Zendesk",
    host: "zendesk.com",
    mark: (s) => letterMark("Z", "bg-[#03363d]", s),
  },
  intercom: {
    title: "Pricing · Intercom",
    host: "intercom.com",
    mark: (s) => letterMark("I", "bg-[#1f1f1f]", s),
  },
  freshdesk: {
    title: "Plans · Freshdesk",
    host: "freshworks.com",
    mark: (s) => letterMark("F", "bg-[#25c16f]", s),
  },
  g2: {
    title: "Help desk software · G2",
    host: "g2.com",
    mark: (s) => letterMark("G2", "bg-[#ff492c]", s),
  },
  wayback: {
    title: "zendesk.com/pricing · Wayback Machine",
    host: "web.archive.org",
    mark: (s) => letterMark("W", "bg-[#5c5c5c]", s),
  },
  notion: {
    title: "Pricing and packaging · Notion",
    host: "notion.so",
    mark: (s) => brand("notion", s ? s.split(" ")[0] : "size-4"),
  },
};

// Files the pricing thread's task makes, and two from the user's folder.
const FILES = {
  comparison: { title: "pricing-comparison.html", kind: "html" },
  prices: { title: "competitor-prices.csv", kind: "csv" },
  faq: { title: "pricing-page-faq.md", kind: "md" },
  board: { title: "q3-board-update.md", kind: "md" },
  quotes: { title: "soc2-audit-quotes.csv", kind: "csv" },
};

/** The colored file-type marks the Finder draws, each in the same box (1.15em, from `cls`'s size) so names line up whatever the kind. */
const fileMark = (kind, cls = "text-[13px]") =>
  `<span class="inline-flex w-[1.15em] shrink-0 items-center justify-center ${cls}">${
    {
      html: `<span class="font-bold text-[#e8793a]">#</span>`,
      md: `<span class="text-[0.72em] font-bold tracking-tighter text-[#3f9d52]">M↓</span>`,
      csv: `<i class="ph ph-table text-[#2f8f5b]"></i>`,
      pdf: `<i class="ph ph-file-pdf text-[#d14b3f]"></i>`,
      folder: `<i class="ph ph-folder text-[#4a9ff5]"></i>`,
    }[kind]
  }</span>`;

/** A tab is {site}, {file}, {folder: name} (Files open on a folder), {browser: true} (Browser with no page) or {newtab: true}; `agent` marks one the task is driving. */
const tabMark = (t, size) =>
  t.site
    ? SITES[t.site].mark(size)
    : t.file
      ? fileMark(FILES[t.file].kind)
      : t.folder
        ? fileMark("folder", "text-[15px]")
        : t.browser
          ? `<i class="ph ph-globe shrink-0 text-[14px]"></i>`
          : `<i class="ph ph-magnifying-glass shrink-0 text-[14px]"></i>`;
const tabTitle = (t) =>
  t.site
    ? SITES[t.site].title
    : t.file
      ? FILES[t.file].title
      : t.folder || t.title || (t.browser ? "Browser" : "New tab");

// ---- window --------------------------------------------------------------------

const GROUND = "bg-[#e7e5e4]";
const trafficLights = `<div class="flex w-20 shrink-0 items-center gap-2 pl-3"><span class="size-3 rounded-full bg-[#ff5f57]"></span><span class="size-3 rounded-full bg-[#febc2e]"></span><span class="size-3 rounded-full bg-[#28c840]"></span></div>`;

/** A window tab in the bar. `t` is a tab ({site} | {file} | {folder} | {newtab}) or {chats: true, title}. */
const barTab = (t, { on = false } = {}) => `
  <div class="relative flex h-8 max-w-48 min-w-20 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm font-medium ${on ? "bg-background shadow-xs" : "text-foreground/55"}">
    ${t.chats ? `<i class="ph ph-chat-circle text-[14px]"></i>` : tabMark(t)}
    <span class="min-w-0 flex-1 truncate">${t.chats ? t.title || "Chats" : tabTitle(t)}</span>${t.agent ? pulse : ""}
    ${on ? `<i class="ph ph-x text-[12px]"></i>` : ""}
  </div>`;

/** The 40px window bar on the ground: back and forward, the window's tabs, then the right corner. */
const winBar = ({ tabs = [{ chats: true }], active = 0, right = "" } = {}) => `
  <div class="flex h-10 shrink-0 items-center gap-1.5 pr-2">
    ${trafficLights}
    <i class="ph ph-arrow-left px-1.5 text-[16px] text-foreground/80"></i><i class="ph ph-arrow-right px-1.5 text-[16px] text-foreground/40"></i>
    <div class="flex min-w-0 flex-1 items-center gap-1 px-2">
      ${tabs.map((t, i) => barTab(t, { on: i === active })).join(`<span class="h-4 w-px shrink-0 bg-gray-300"></span>`)}
      <span class="grid size-8 shrink-0 place-items-center rounded-xl"><i class="ph ph-plus text-[16px]"></i></span>
    </div>
    <div class="flex shrink-0 items-center gap-2">${right}</div>
  </div>`;

/** Files' mark on the Mac: the Finder's face as a line glyph on Phosphor's grid (finder-icon.tsx), since Phosphor has no Finder. */
const finderGlyph = (cls = "size-6") =>
  `<svg class="${cls} shrink-0" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><path d="M64 32h128a32 32 0 0 1 32 32v128a32 32 0 0 1-32 32H64a32 32 0 0 1-32-32V64a32 32 0 0 1 32-32ZM140 32q-28 60-36 116h28q-4 40 4 76M84 88v20M172 88v20M80 172q48 26 96 0"/></svg>`;

// The starter loads Phosphor's regular weight only, so a lit place keeps its outline
// icon and takes the brand color, where the app also swaps to the fill weight.
const RAIL = [
  ["chat", "Chat", `<i class="ph ph-chat-circle text-[24px]"></i>`],
  ["files", "Files", finderGlyph()],
  ["browser", "Browser", `<i class="ph ph-globe text-[24px]"></i>`],
  ["apps", "Apps", `<i class="ph ph-shapes text-[24px]"></i>`],
];

/** The 76px app rail on the ground. `on` is chat | files | browser | apps | "" (nothing lit). `user` draws the signed-in avatar in place of Settings. */
const rail = (on = "chat", { mark = {}, user = false } = {}) => `
  <nav class="flex w-[76px] shrink-0 flex-col items-center gap-3 pt-1 pb-2">
    <div class="flex w-15 flex-col items-center gap-0.5 py-1.5">
      <span class="grid size-11 place-items-center rounded-full bg-brand-600 text-white shadow-xs"><i class="ph ph-note-pencil text-[20px]"></i></span>
      <span class="text-[11px] leading-4 font-medium">New</span>
      ${mark.new || ""}
    </div>
    <div class="flex w-full flex-col items-center gap-1">
      ${RAIL.map(
        ([key, word, icon]) => `
        <div class="flex w-15 flex-col items-center gap-0.5 rounded-xl py-1.5 ${on === key ? "bg-foreground/8 text-brand-600" : "text-muted-foreground"}">
          <span class="flex h-6 items-center">${icon}</span>
          <span class="text-[11px] leading-4 ${on === key ? "font-medium" : ""}">${word}</span>
          ${mark[key] || ""}
        </div>`,
      ).join("")}
    </div>
    <div class="flex-1"></div>
    ${
      user
        ? `<div class="grid w-15 place-items-center rounded-xl p-2"><span class="grid size-11 place-items-center rounded-xl bg-[#c5d5d0] text-[15px] font-semibold text-brand-800">J</span></div>`
        : `<div class="flex w-15 flex-col items-center gap-0.5 py-1.5 text-muted-foreground"><span class="flex h-6 items-center"><i class="ph ph-faders-horizontal text-[24px]"></i></span><span class="text-[11px] leading-4">Settings</span></div>`
    }
  </nav>`;

/** The whole window. `over` is drawn on a layer over everything (floating chats, menus, sheets). */
const appWindow = ({
  bar = winBar(),
  on = "chat",
  body = inboxCol({ on: -1 }) + noChatOpen(),
  over = "",
  railMark = {},
  user = false,
} = {}) => `
  <div class="relative flex h-full flex-col overflow-hidden ${GROUND} text-foreground [color-scheme:light]">
    ${bar}
    <div class="flex min-h-0 flex-1">
      ${rail(on, { mark: railMark, user })}
      <div class="relative mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-2xl bg-background shadow-xs">${body}</div>
    </div>
    ${over}
  </div>`;

/** Chat with none selected: what sits beside the inbox. There is no Home page. */
const noChatOpen = () => `
  <div class="flex min-w-0 flex-1 flex-col items-center justify-center bg-muted/20 text-center">
    <span class="mb-5 grid size-14 place-items-center rounded-2xl text-muted-foreground/30 shadow-md inset-ring inset-ring-current/60"><i class="ph ph-chats-circle text-[28px]"></i></span>
    <span class="text-sm font-medium text-muted-foreground">No chat selected</span>
    <span class="mt-0.5 max-w-72 text-[13px] leading-6 text-muted-foreground/60">Select a chat or start a new one</span>
    <span class="mt-5 flex h-8 items-center gap-1.5 rounded-full bg-card pr-1.5 pl-2.5 text-sm font-medium shadow-sm"><i class="ph ph-note-pencil"></i>New chat<span class="ml-0.5 flex h-5 items-center rounded-full bg-black/5 px-1.5 text-[11px] text-muted-foreground ring-1 ring-black/8">⌘N</span></span>
  </div>`;

// ---- inbox ---------------------------------------------------------------------

const ROWS = [
  {
    title: "Help desk pricing against competitors",
    preview:
      "It's going well: the task is reading each pricing page and noting what every tier includes.",
    step: "Reading plans on zendesk.com",
    unread: true,
    working: true,
    time: "9:41 AM",
    holds: [{ site: "zendesk" }, { site: "intercom" }, { site: "freshdesk" }],
  },
  {
    title: "SOC 2 audit quotes from four firms",
    preview:
      "Three of the four replied. Ridgeline is the lowest, and the only one that includes a readiness review.",
    starred: true,
    time: "Yesterday",
    holds: [{ file: "quotes" }],
  },
  {
    title: "Q3 board update in the Instrument folder",
    preview: "That was q3-board-update.md, in your Instrument folder.",
    time: "Mon",
    holds: [{ file: "board" }],
  },
  {
    title: "Renewal reminders for October accounts",
    preview:
      "The 14 drafts are ready in Gmail; nothing is sent until you say so.",
    time: "Sep 26",
    holds: [{ app: "gmail" }],
  },
  {
    title: "demo-page HTML file in the Instrument folder",
    preview:
      "From its name alone, this is an HTML file called demo-page sitting in your Instrument folder.",
    time: "Sep 24",
  },
];

/** The views the picker names besides Chats, as filter-head.tsx tints them: Starred in amber, the rest in a quiet grey. */
const PLACES = {
  starred: ["Starred", "ph-star", "bg-warning-50 text-warning-700"],
  drafts: ["Drafts", "ph-circle-dashed", "bg-foreground/6 text-foreground/80"],
  archived: ["Archived", "ph-archive", "bg-foreground/6 text-foreground/80"],
};

/**
 * The line over the inbox: one 36px picker chip naming the view the list stands in (Chats
 * in the brand's pale green, or a `place`: starred | drafts | archived in its own tint,
 * led by its mark),
 * its menu holding the other views and the topics, and the search beside it, which reads
 * inside that view.
 */
const inboxHead = ({ place = "" } = {}) => {
  const [label, icon, tone] = PLACES[place] ?? [
    "Chats",
    "ph-chats-circle",
    "bg-brand-50 text-brand-800",
  ];
  return `
  <div class="flex items-center gap-2 px-2 py-3">
    <span class="flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-2.5 ${place ? "pl-3" : "pl-3.5"} text-[15px] font-semibold ${tone}">${place ? `<i class="ph ${icon} text-[16px]"></i>` : ""}${label}<i class="ph ph-caret-down text-[14px] opacity-50"></i></span>
    <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-gradient-to-b from-white to-[#fafaf9] pl-3 text-[13px] text-muted-foreground shadow-sm"><i class="ph ph-magnifying-glass text-[14px]"></i>${place ? `Search ${label}` : "Search"}</div>
  </div>`;
};

/** What a chat holds, on its row's third line: files as chips with their names, apps and sites as bare marks. Holds are {file}, {site} or {app} (a key of BRAND_URI). */
const holdMarks = (holds = []) =>
  holds
    .map((h) =>
      h.file
        ? `<span class="inline-flex h-5 max-w-52 shrink-0 items-center gap-1 rounded-md bg-foreground/4 pr-1.5 pl-1 text-[11px] text-muted-foreground">${fileMark(FILES[h.file].kind, "text-[12px]")}<span class="truncate">${FILES[h.file].title}</span></span>`
        : h.site
          ? `<span class="grid size-5 shrink-0 place-items-center">${SITES[h.site].mark("size-3.5 text-[7px]")}</span>`
          : `<span class="grid size-5 shrink-0 place-items-center">${brand(h.app, "size-3.5")}</span>`,
    )
    .join("");

/**
 * An inbox row, as chat-row.tsx lays it out, three lines every row keeps: the title
 * (semibold only while something in it is unseen) with the star at its end; the agent's
 * latest line (the `step` shimmering while it works, `ask` behind an amber glyph while it
 * waits on you, otherwise the `preview`); then what it holds, with the time in the corner.
 */
const row = (r, { on = false, first = false } = {}) => `
  <div class="relative flex flex-col px-3 py-2.5 ${first ? "" : "border-t border-border"} ${on ? "bg-brand-50" : ""}">
    <div class="flex h-5 items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[13px] ${r.unread ? "font-semibold" : "font-medium text-foreground/85"}">${r.title}</span>
      ${r.starred ? `<i class="ph ph-star text-[14px] text-warning-500"></i>` : ""}
    </div>
    <div class="flex h-5 min-w-0 items-center gap-1.5 text-[12px]">${
      r.working && r.step
        ? `<span class="truncate text-brand-600">${r.step}</span>`
        : r.ask
          ? `<i class="ph ph-warning-circle shrink-0 text-[14px] text-warning-700"></i><span class="truncate text-foreground/80">${r.ask}</span>`
          : `<span class="truncate text-muted-foreground">${r.preview || ""}</span>`
    }</div>
    <div class="mt-1 flex h-5 items-center gap-2">
      <span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">${holdMarks(r.holds)}</span>
      <span class="ml-auto w-14 shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums">${r.time || ""}</span>
    </div>
  </div>`;

/**
 * A draft in the Drafts place, as draft-row.tsx lays it out: a dashed circle in the gutter
 * where a chat wears its state, the first line of its words as the title, when it was last
 * touched at the right, and "Draft" where a chat's latest line goes, then the marks of
 * what it holds (`holds`, as a chat row's) the way a chat row shows them.
 */
const draftRow = (d, { first = false } = {}) => `
  <div class="flex gap-2 px-3 py-2.5 ${first ? "" : "border-t border-border"}">
    <span class="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"><i class="ph ph-circle-dashed text-[14px]"></i></span>
    <div class="min-w-0 flex-1">
      <div class="flex h-5 items-center gap-1.5"><span class="min-w-0 flex-1 truncate text-[13px] text-foreground/90">${d.title}</span><span class="shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums">${d.time || ""}</span></div>
      <div class="mt-0.5 flex items-center gap-2 text-[12px] leading-5 text-muted-foreground">Draft${d.holds ? `<span class="flex min-w-0 items-center gap-1">${holdMarks(d.holds)}</span>` : ""}</div>
    </div>
  </div>`;

/**
 * The inbox column: head, rows. `on` is the open row's index (-1 for none). `place`
 * stands it in another view (starred | drafts | archived); `drafts` ([{ title, time,
 * holds }]) stands it in Drafts and lists those instead.
 */
const inboxCol = ({
  on = 0,
  w = 320,
  rows = ROWS,
  place = "",
  drafts,
} = {}) => `
  <div class="flex shrink-0 flex-col border-r border-border bg-background" style="width:${w}px">
    ${inboxHead({ place: drafts ? "drafts" : place })}
    <div class="mt-1 flex flex-col">${
      drafts
        ? drafts.map((d, i) => draftRow(d, { first: i === 0 })).join("")
        : rows.map((r, i) => row(r, { on: i === on, first: i === 0 })).join("")
    }</div>
  </div>`;

// ---- a chat --------------------------------------------------------------------

/**
 * The chat header, as chat-header.tsx draws it: the inbox toggle, the title with its caret
 * (which opens the chat's menu), then at the right what the chat has in flight and the
 * pop-out glyph, then `right` (the pane toggle while the pane is shut). `working` is the
 * work in flight (from workLine) while a task runs; `tasks` draws the quiet checklist a
 * chat whose tasks have all finished keeps there. A chat that filed no task has neither.
 */
const threadHead = (
  title,
  { right = "", working = "", tasks = false } = {},
) => `
  <div class="flex shrink-0 items-center gap-2 bg-background p-3">
    <span class="grid size-7 shrink-0 place-items-center text-foreground/80"><i class="ph ph-sidebar-simple text-[16px]"></i></span>
    <span class="flex h-8 min-w-0 items-center gap-1 text-sm font-medium"><span class="truncate">${title}</span><i class="ph ph-caret-down shrink-0 text-[12px] text-muted-foreground"></i></span>
    <span class="flex-1"></span>
    ${working || (tasks ? tasksMark : "")}
    <span class="grid size-8 shrink-0 place-items-center text-muted-foreground"><i class="ph ph-picture-in-picture text-[16px]"></i></span>
    ${right}
  </div>`;

/** The checklist a head keeps once a chat's tasks have finished; pressed, it lists them. */
const tasksMark = `<span class="grid size-8 shrink-0 place-items-center text-muted-foreground"><i class="ph ph-list-checks text-[16px]"></i></span>`;

/** The agent at work (planning-dot.tsx): a 10px brand sphere with its ring traveling out, in a 20px box. */
const planningDot = `<span class="relative grid size-5 shrink-0 place-items-center"><span class="absolute size-3.5 rounded-full border-2 border-brand-400/40"></span><span class="size-2.5 rounded-full bg-gradient-to-br from-brand-400 to-brand-700"></span></span>`;

/** Where the transcript starts: when the chat began and the model that answered, centered and small. */
const turnMeta = ({
  when = "Today 9:41 AM",
  model = "Auto",
  mark = "instrumentglyph",
} = {}) =>
  `<div class="flex items-center justify-center gap-1.5 pb-1 text-[12px] text-muted-foreground"><span>${when}</span><span>·</span>${brand(mark, "size-3.5 opacity-70")}<span>${model}</span></div>`;

const you = (text) =>
  `<div class="flex justify-end"><div class="max-w-[80%] rounded-2xl rounded-tr-md bg-[#bcdcd2] px-3.5 py-2 text-sm text-foreground">${text}</div></div>`;
const agent = (text) =>
  `<div class="max-w-[85%] rounded-2xl rounded-tl-md bg-card px-3.5 py-2 text-sm leading-[1.5]">${text}</div>`;

/** A file the agent linked, as the transcript's file card: its picture on a small page, the name, and its kind under it. */
const FILE_KINDS = { html: "HTML", csv: "CSV", md: "Markdown", pdf: "PDF" };
const fileRow = (key) => `
  <div class="flex w-90 max-w-[85%] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"><span class="grid h-12 w-9 shrink-0 place-items-center rounded-sm bg-white shadow-xs ring-1 ring-border">${fileMark(FILES[key].kind)}</span><span class="flex min-w-0 flex-col"><span class="truncate text-sm">${FILES[key].title}</span><span class="text-[12px] text-muted-foreground">${FILE_KINDS[FILES[key].kind]}</span></span></div>`;

/** A page the agent opened, as a thin row in the transcript. */
const pageRow = (site) => `
  <div class="flex max-w-[85%] items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px]">${SITES[site].mark()}<span class="truncate">${SITES[site].title}</span></div>`;

/** The work in flight, at a chat head's right while its tasks run: the breathing planning dot and the step the newest is on in the brand's shimmer, or with `compact` (a head too narrow for the step) the dot alone. Pressed, it lists the chat's tasks. */
const workLine = (
  text = "Reading plans on zendesk.com",
  { compact = false } = {},
) => `
  <span class="flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-[12px]">${planningDot}${compact ? "" : `<span class="truncate text-brand-600">${text}</span>`}</span>`;

/** The plus that opens the reply box's menu: a 28px round on the stone ground. */
const plusButton = `<span class="grid size-7 shrink-0 place-items-center rounded-full bg-gray-100"><i class="ph ph-plus text-[16px] text-foreground/60"></i></span>`;

const replyBox = ({ ph = "Talk to Instrument", text = "" } = {}) => `
  <div class="flex items-center gap-2 rounded-[22px] bg-white p-1.5 shadow-sm">
    ${plusButton}
    <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
    <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>
  </div>`;

const PRICING_TITLE = "Help desk pricing against competitors";

/** The pricing chat's transcript. `stage` 1: running; 2: pages opened; 3: finished with files. */
const pricing = (stage = 1) =>
  [
    turnMeta(),
    you("How does our pricing compare with Zendesk, Intercom and Freshdesk?"),
    agent(
      "I'll line up each one's list prices against our plans, per agent per month and billed annually, for a 10-agent team; say the word if you'd rather compare at a different size.",
    ),
    stage >= 2
      ? agent(
          "It's going well: the task is reading each pricing page and noting what every tier includes. I'll let you know when the comparison is ready.",
        )
      : "",
    stage >= 3
      ? agent(
          "The comparison is ready: at 10 agents our Team plan is 18% under Zendesk Suite Team and 8% under Freshdesk Pro. Intercom looks cheaper per seat, but its AI agent bills per resolution.",
        )
      : "",
    stage >= 3 ? fileRow("comparison") + fileRow("prices") : "",
  ]
    .filter(Boolean)
    .join("");

/** A chat column: header (with the work in flight while `working` names a step, or with `tasks` the checklist of finished ones), the centered transcript, then its tiles (`tiles`, from chatTiles) over the reply box. */
const thread = ({
  title = PRICING_TITLE,
  body = pricing(2),
  working = "",
  tasks = false,
  tiles = "",
  head = "",
  foot = "",
  reply = {},
  replyEl = "",
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${head || threadHead(title, { working: working ? workLine(working) : "", tasks })}
    <div class="min-h-0 flex-1 overflow-hidden"><div class="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4">${body}</div></div>
    <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${tiles}${foot}${replyEl || replyBox(reply)}</div>
  </div>`;

// ---- tabs, the pane, pages -------------------------------------------------------

const pulse = `<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-500"></span>`;

/** The pill at the omnibar's end that opens what is shown in its Mac app, wearing that app's icon: the Finder for a folder, the browser for a page or an HTML file, a text editor or a spreadsheet for the rest. */
const openIn = (kind) =>
  ({
    folder: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#1e88f0] text-white"><i class="ph ph-smiley text-[11px]"></i></span>`,
    site: `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-[#1e88f0] text-white"><i class="ph ph-compass text-[11px]"></i></span>`,
    html: `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-[#1e88f0] text-white"><i class="ph ph-compass text-[11px]"></i></span>`,
    md: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-white text-foreground/70 ring-1 ring-border"><i class="ph ph-note-pencil text-[10px]"></i></span>`,
    csv: `<span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[#2f8f5b] text-white"><i class="ph ph-chart-bar text-[10px]"></i></span>`,
  })[kind] ?? "";

/** Ask, which starts a chat about what is shown: the Instrument glyph, and its word where the row has room (`label`). */
const askButton = (label = true) =>
  `<span class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground/70">${brand("instrumentglyph", "size-3.5")}${label ? "Ask" : ""}</span>`;

/**
 * The location row over a page or file (browser-panel.tsx's tab row): three columns, with
 * the omnibar centered at up to 640px and an open-in pill at its end, then Ask and the
 * page's menu at the right. In a pane or peek (`close`) the left holds back and forward and
 * the right ends in Expand (a file's, or with `expand`) and the × that puts the view away;
 * filling the Browser place (`place`) the left holds reload, since a window tab's history
 * is the bar's back and forward, and Ask has its word.
 */
const locRow = (t, { close = false, expand = false, place = false } = {}) => `
  <div class="grid h-10 shrink-0 grid-cols-[1fr_minmax(0,640px)_1fr] items-center gap-1 border-b border-border bg-background px-2 text-foreground/60">
    <div class="flex items-center gap-1">${
      place
        ? `<span class="grid size-7 place-items-center"><i class="ph ph-arrow-clockwise text-[16px]"></i></span>`
        : `<span class="grid size-7 place-items-center"><i class="ph ph-caret-left text-[16px]"></i></span><span class="grid size-7 place-items-center text-foreground/25"><i class="ph ph-caret-right text-[16px]"></i></span>`
    }</div>
    <div class="flex h-7 min-w-0 items-center gap-2 rounded-full border border-border bg-card pr-1 pl-3 text-[12px]">
      ${
        !t || t.newtab
          ? `<span class="flex-1 text-gray-400">Search or enter address</span>`
          : t.site
            ? `<span class="min-w-0 flex-1 truncate text-foreground/70">${SITES[t.site].host}</span>${openIn("site")}`
            : `${fileMark(FILES[t.file].kind)}<span class="flex min-w-0 flex-1 items-center gap-1"><span class="text-muted-foreground">Instrument</span><i class="ph ph-caret-right text-[10px] text-muted-foreground/50"></i><span class="truncate text-foreground">${FILES[t.file].title}</span></span>${openIn(FILES[t.file].kind)}`
      }
    </div>
    <div class="flex items-center justify-end gap-1">
      ${t && !t.newtab ? askButton(place) + `<span class="grid size-7 place-items-center"><i class="ph ph-dots-three-vertical text-[16px]"></i></span>` : ""}
      ${close && (expand || t?.file) ? `<span class="grid size-7 place-items-center"><i class="ph ph-arrows-out-simple text-[16px]"></i></span>` : ""}
      ${close ? `<span class="grid size-7 place-items-center"><i class="ph ph-x text-[16px]"></i></span>` : ""}
    </div>
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

const bars2 = (...ws) =>
  ws
    .map(
      (w) =>
        `<div class="h-[7px] rounded-full bg-gray-300" style="width:${w}"></div>`,
    )
    .join("");

/** Plausible page bodies, drawn small so they survive any width. */
const PAGES = {
  zendesk: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center gap-2 bg-[#03363d] px-4 text-[13px] font-bold text-white">zendesk<span class="flex-1"></span><span class="font-normal">USD · Billed annually</span></div>
      <div class="p-4">
        <div class="text-[15px] font-semibold">Zendesk Suite</div>
        <div class="mt-1 text-[11px] text-muted-foreground">Per agent per month</div>
        ${[
          ["Suite Team", "Ticketing, messaging, help center", "$55"],
          ["Suite Growth", "Adds SLAs and multiple brands", "$89"],
          ["Suite Professional", "Adds skills routing and HIPAA", "$115"],
        ]
          .map(
            ([n, d, p], i) =>
              `<div class="mt-2.5 flex items-center gap-3 rounded-lg border ${i === 0 ? "border-[#03363d]" : "border-border"} p-2.5 text-[12px]"><div class="min-w-0 flex-1"><div class="font-medium">${n}</div><div class="mt-0.5 truncate text-[11px] text-muted-foreground">${d}</div></div><span class="font-semibold">${p}</span></div>`,
          )
          .join("")}
      </div>
    </div>`,
  intercom: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center border-b border-border px-4 text-[13px] font-bold">intercom</div>
      <div class="p-4">
        <div class="text-[15px] font-semibold">Plans for every team</div>
        <div class="mt-3 grid grid-cols-3 gap-2">
          ${[
            ["Essential", "$29"],
            ["Advanced", "$85"],
            ["Expert", "$132"],
          ]
            .map(
              ([n, p]) =>
                `<div class="rounded-lg border border-border p-2.5 text-[12px]"><div class="font-medium">${n}</div><div class="mt-1.5 text-[16px] font-semibold">${p}</div><div class="text-[10px] text-muted-foreground">per seat / mo</div></div>`,
            )
            .join("")}
        </div>
        <div class="mt-3 rounded-lg bg-[#f4f4f1] px-3 py-2 text-[11px]">Fin AI Agent: $0.99 per resolution, on every plan</div>
      </div>
    </div>`,
  freshdesk: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center bg-[#25c16f] px-4 text-[13px] font-bold text-white">freshdesk</div>
      <div class="p-4 text-[12px]"><div class="text-[14px] font-semibold">Support desk plans</div><div class="mt-3 space-y-2">${[
        ["Growth", "$15"],
        ["Pro", "$49"],
        ["Enterprise", "$79"],
      ]
        .map(
          ([n, p]) =>
            `<div class="flex justify-between border-b border-border pb-1.5"><span>${n}</span><span class="text-muted-foreground">agent / mo, billed annually</span><span class="font-semibold">${p}</span></div>`,
        )
        .join("")}</div></div>
    </div>`,
  g2: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Best Help Desk Software</div><div class="mt-1 border-b border-border pb-2 text-[10px] text-muted-foreground">Ranked by user reviews</div>${["Zendesk", "Freshdesk", "Intercom", "Help Scout"].map((n) => `<div class="mt-3 flex items-center gap-3"><div class="size-8 shrink-0 rounded bg-[#f3e8e6]"></div><div class="min-w-0 flex-1"><div class="text-[12px] font-medium">${n}</div><div class="mt-1.5 space-y-1.5">${bars2("80%")}</div></div></div>`).join("")}</div>`,
  wayback: () =>
    `<div class="h-full bg-white"><div class="flex h-9 items-center gap-2 border-b border-border bg-[#f4f4f4] px-4 text-[11px] text-muted-foreground"><span class="font-semibold text-foreground">INTERNET ARCHIVE</span>zendesk.com/pricing · captured 12 Oct 2025</div><div class="p-4"><div class="text-[14px] font-semibold">Zendesk Suite</div><div class="mt-3 space-y-2 text-[12px]">${[
      ["Suite Team", "$55"],
      ["Suite Growth", "$89"],
      ["Suite Professional", "$115"],
    ]
      .map(
        ([n, p]) =>
          `<div class="flex justify-between border-b border-border pb-1.5"><span>${n}</span><span>${p}</span></div>`,
      )
      .join("")}</div></div></div>`,
  notion: () =>
    `<div class="h-full bg-white p-6"><div class="text-[22px] font-bold">Pricing and packaging</div><div class="mt-4 space-y-2">${bars2("60%", "44%", "52%")}</div></div>`,
  comparison: () => `
    <div class="h-full bg-white p-5">
      <div class="text-[11px] font-medium tracking-wide text-[#e8793a] uppercase">Help desk pricing · Oct 2026</div>
      <div class="mt-1 text-[18px] font-semibold">Our plans against three competitors</div>
      <div class="mt-1 text-[11px] text-muted-foreground">10 agents, per agent per month, billed annually</div>
      ${[
        ["Zendesk Suite Team", "$55", 100],
        ["Freshdesk Pro", "$49", 89],
        ["Our Team plan", "$45", 82],
        ["Intercom Essential", "$29 + AI usage", 53],
      ]
        .map(
          ([n, p, w]) =>
            `<div class="mt-3 flex items-center justify-between text-[12px] font-medium"><span>${n}</span><span>${p}</span></div><div class="mt-1.5 h-[7px] rounded-full ${n.startsWith("Our") ? "bg-[#e8793a]" : "bg-gray-300"}" style="width:${w}%"></div>`,
        )
        .join("")}
      <div class="mt-5 text-[12px] font-medium">What each tier includes</div>
      <div class="mt-1.5 space-y-1.5">${bars2("92%", "64%", "78%")}</div>
    </div>`,
  prices: () => `
    <div class="h-full bg-white p-3 font-mono text-[11px]">
      ${[
        ["vendor", "plan", "agent/mo", "10 agents/yr"],
        ["Zendesk", "Suite Team", "$55", "$6,600"],
        ["Freshdesk", "Pro", "$49", "$5,880"],
        ["Intercom", "Essential", "$29", "$3,480+"],
        ["Ours", "Team", "$45", "$5,400"],
      ]
        .map(
          (r, i) =>
            `<div class="grid grid-cols-[1fr_1fr_60px_84px] border-b border-border py-1.5 ${i ? "" : "font-semibold"}">${r.map((c) => `<span>${c}</span>`).join("")}</div>`,
        )
        .join("")}
    </div>`,
  faq: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Pricing page FAQ</div><div class="mt-3 space-y-2">${bars2("40%", "52%", "36%", "48%")}</div></div>`,
  board: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Q3 board update</div><div class="mt-3 space-y-2">${bars2("50%", "62%", "44%")}</div></div>`,
  newtab: () => `
    <div class="h-full bg-card p-6">
      <div class="text-[13px] font-medium text-muted-foreground">This Mac</div>
      <div class="mt-3 grid grid-cols-2 gap-2">${["Instrument", "Desktop", "Documents", "Downloads"].map((n) => `<div class="flex items-center gap-2 rounded-lg border border-border p-2.5 text-[12px]">${fileMark("folder", "text-[18px]")}${n}</div>`).join("")}</div>
      <div class="mt-5 text-[13px] font-medium text-muted-foreground">Recent files</div>
      <div class="mt-2 space-y-2">${bars2("55%", "40%")}</div>
    </div>`,
};

const page = (t) =>
  t.site ? PAGES[t.site]() : t.file ? PAGES[t.file]() : PAGES.newtab();

// ---- places --------------------------------------------------------------------

/** Browser, an app or a skill (Files has filesPlace): the place fills the card, under its location row (none on Apps). Its tabs are the window's, in the bar. */
const placeCard = ({ tab, body, loc = true }) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${loc ? locRow(tab, { place: true }) : ""}
    <div class="relative min-h-0 flex-1 overflow-hidden">${body ?? page(tab)}</div>
  </div>`;

/** Browser with no page open: the omnibar alone in the top row, then Bookmarks and Recent pages under their ruled labels. `recent` are SITES keys. */
const browserHome = ({ recent = ["zendesk", "g2"] } = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="grid h-10 shrink-0 grid-cols-[1fr_minmax(0,640px)_1fr] items-center border-b border-border px-2"><span></span><div class="flex h-7 items-center rounded-full border border-border bg-card px-3 text-[12px] text-gray-400">Search or enter address</div><span></span></div>
    <div class="mx-auto flex w-full max-w-[944px] flex-col gap-4 px-6 pt-20">
      <div class="flex items-center gap-3 text-[13px] text-muted-foreground">Bookmarks<span class="h-px flex-1 bg-border"></span></div>
      <div class="flex flex-col items-center gap-2 rounded-2xl bg-foreground/[0.03] py-10 text-center">
        <span class="mb-2 grid size-14 place-items-center rounded-xl bg-white text-muted-foreground shadow-sm"><i class="ph ph-globe text-[20px]"></i></span>
        <span class="text-sm font-medium">No bookmarks yet</span>
        <span class="text-[13px] text-muted-foreground">Choose <span class="font-medium text-foreground/80">Add to bookmarks</span> from the ⋮ menu on a website to add bookmarks</span>
      </div>
      <div class="mt-4 flex items-center gap-3 text-[13px] text-muted-foreground">Recent pages<span class="h-px flex-1 bg-border"></span></div>
      <div class="grid grid-cols-2 gap-2">${recent.map((k) => `<div class="flex h-9 items-center gap-2 rounded-lg bg-foreground/[0.04] px-3 text-[13px]">${SITES[k].mark()}<span class="truncate">${SITES[k].title}</span></div>`).join("")}</div>
    </div>
  </div>`;

// Files, measured off the documents fixture (2026-10-10) at 1240x840. The card opens on
// a 40px top row: the sidebar toggle, the omnibar centered across the card (640 wide)
// ending in the pill that opens what is shown in its Mac app, and the open file's
// own controls at the right. Under it a folder gets the 175px sidebar of places and the
// Finder's 48px header; a file gets the 240px tree of its folder in place of the places.

const FINDER_FILES = [
  ["folder", "ai-spend"],
  ["html", "comparison-index.html"],
  ["md", "claude-usage-report.md"],
  ["folder", "cat-word-doc"],
  ["html", "pricing-comparison.html"],
  ["csv", "competitor-prices.csv"],
  ["md", "pricing-page-faq.md"],
  ["md", "q3-board-update.md"],
  ["html", "demo-page.html"],
];

const toolBtn = (inner, cls = "") =>
  `<span class="flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-card px-2 text-muted-foreground ring-1 ring-border ${cls}">${inner}</span>`;

/** Files' top row. `mark` leads the omnibar (a folder, or the open file's type), `crumbs` are its path, `open` the kind whose Mac app the open-in pill at its end wears (openIn), `right` the open file's controls (fileActions). */
const filesTop = ({
  crumbs = ["studio26"],
  mark = fileMark("folder", "text-[15px]"),
  open = "folder",
  right = "",
  left = "",
} = {}) => `
  <div class="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border px-2">
    <div class="flex items-center gap-1"><span class="grid size-8 place-items-center rounded-lg text-muted-foreground"><i class="ph ph-sidebar-simple text-[17px]"></i></span>${left}</div>
    <div class="flex h-8 w-[640px] min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-[13px] shadow-xs">
      ${mark}${crumbs.map((c, i) => `<span class="truncate ${i === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground"}">${c}</span>`).join(`<i class="ph ph-caret-right text-[10px] text-muted-foreground"></i>`)}
      <span class="flex-1"></span>${openIn(open)}
    </div>
    <div class="flex items-center justify-end gap-1">${right}</div>
  </div>`;

/** The open file's controls in the top row: Viewing (or Editing), Ask and its menu. A file filling a window tab has no Expand; `expand` draws it for one that does not. */
const fileActions = ({ editing = false, ask = "Ask", expand = false } = {}) => `
  <span class="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] ${editing ? "bg-foreground text-background" : "text-muted-foreground"}"><i class="ph ph-${editing ? "pencil-simple" : "eye"} text-[15px]"></i>${editing ? "Editing" : "Viewing"}<i class="ph ph-caret-down text-[10px]"></i></span>
  <span class="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium">${brand("instrumentglyph", "size-4")}${ask}</span>
  <span class="grid size-8 place-items-center text-muted-foreground"><i class="ph ph-dots-three-vertical text-[16px]"></i></span>
  ${expand ? `<span class="grid size-8 place-items-center text-muted-foreground"><i class="ph ph-arrows-out-simple text-[15px]"></i></span>` : ""}`;

/** The Finder's sidebar of places: Recents and the Instrument folder, then the folders the person pinned (`places`) and the Locations. `starred` adds a Starred place over Recents. */
const finderSidebar = ({
  on = "studio26",
  starred = false,
  places = ["studio26", "Desktop", "Documents", "Downloads"],
} = {}) => {
  const item = (icon, name) =>
    `<div class="flex h-7 items-center gap-2 rounded-lg px-2 ${name === on ? "bg-foreground/8" : ""}">${icon}<span class="truncate">${name}</span></div>`;
  const placeIcon = (n) =>
    n === "Instrument"
      ? `<i class="ph ph-folder-simple shrink-0 text-[15px] text-[#3f9d8a]"></i>`
      : n === "studio26"
        ? `<i class="ph ph-house shrink-0 text-[15px] text-muted-foreground"></i>`
        : fileMark("folder", "text-[15px]");
  return `
  <div class="w-[175px] shrink-0 border-r border-border px-2 pt-2 text-[13px]">
    ${starred ? item(`<i class="ph ph-star shrink-0 text-[15px] text-muted-foreground"></i>`, "Starred") : ""}
    ${item(`<i class="ph ph-clock-counter-clockwise shrink-0 text-[15px] text-muted-foreground"></i>`, "Recents")}
    ${item(placeIcon("Instrument"), "Instrument")}
    <div class="px-2 pt-3 pb-1 text-[12px] text-muted-foreground">Pinned</div>
    ${places.map((n) => item(placeIcon(n), n)).join("")}
    <div class="px-2 pt-3 pb-1 text-[12px] text-muted-foreground">Locations</div>
    ${item(`<i class="ph ph-cloud shrink-0 text-[15px] text-muted-foreground"></i>`, "iCloud Drive")}
    ${item(`<i class="ph ph-hard-drive shrink-0 text-[15px] text-muted-foreground"></i>`, "Macintosh HD")}
  </div>`;
};

/** The view picker: Grid, List, Columns, and any `extra` views a proposal adds as [key, icon]. */
const finderViews = (view = "columns", extra = []) =>
  `<span class="flex h-8 items-center rounded-lg bg-foreground/8 p-0.5">${[["icons", "ph-squares-four"], ["list", "ph-rows"], ["columns", "ph-columns"], ...extra].map(([k, i]) => `<span class="grid h-7 w-8 place-items-center rounded-md ${k === view ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}"><i class="ph ${i} text-[15px]"></i></span>`).join("")}</span>`;

/** The Finder's 48px header: the folder's name, then Ask, the views, sort, filter, more and search. */
const finderHeader = ({
  title = "studio26",
  views = finderViews(),
  ask = "Ask",
} = {}) => `
  <div class="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3">
    <span class="min-w-0 flex-1 truncate text-[15px] font-semibold">${title}</span>
    ${toolBtn(`${brand("instrumentglyph", "size-4")}<span class="text-[13px] font-medium text-foreground">${ask}</span>`, "px-2.5")}
    ${views}
    ${toolBtn(`<i class="ph ph-arrows-down-up text-[15px]"></i><i class="ph ph-caret-down text-[9px]"></i>`)}
    ${toolBtn(`<i class="ph ph-funnel-simple text-[15px]"></i>`)}
    ${toolBtn(`<i class="ph ph-dots-three text-[15px]"></i>`)}
    ${toolBtn(`<i class="ph ph-magnifying-glass text-[15px]"></i>`)}
  </div>`;

/** The Finder's list view: Name, Date Modified, Size and Kind over 24px striped rows. Rows are [kind, name, modified, size, kindText]. */
const finderListView = (rows, { pick = -1 } = {}) => `
  <div class="text-[13px]">
    <div class="grid h-7 items-center border-b border-border px-3 text-[12px] text-muted-foreground" style="grid-template-columns:1fr 170px 70px 110px"><span class="pl-6">Name <i class="ph ph-caret-up text-[9px]"></i></span><span>Date Modified</span><span class="text-right">Size</span><span class="pl-3">Kind</span></div>
    ${rows.map(([k, n, d, sz, kt], i) => `<div class="grid h-6 items-center px-3 ${i === pick ? "bg-brand-600 text-white" : i % 2 ? "bg-foreground/[0.03]" : ""}" style="grid-template-columns:1fr 170px 70px 110px"><span class="flex min-w-0 items-center gap-2">${fileMark(k)}<span class="truncate">${n}</span></span><span class="${i === pick ? "" : "text-muted-foreground"}">${d}</span><span class="text-right ${i === pick ? "" : "text-muted-foreground"}">${sz}</span><span class="pl-3 ${i === pick ? "" : "text-muted-foreground"}">${kt}</span></div>`).join("")}
  </div>`;

/** A file's folder as the tree beside it: 240px, 24px rows, the open file in the brand color. Rows are [depth, kind, name]. */
const fileTree = (rows, { on = "" } = {}) => `
  <div class="w-[240px] shrink-0 overflow-hidden border-r border-border px-1.5 py-1 text-[13px]">
    ${rows.map(([d, k, n]) => `<div class="flex h-6 items-center gap-1.5 rounded-md pr-2 ${n === on ? "bg-brand-600 text-white" : ""}" style="padding-left:${8 + d * 16}px">${k === "folder" ? `<i class="ph ph-caret-${d === 0 ? "down" : "right"} text-[10px] ${n === on ? "" : "text-muted-foreground"}"></i>` : `<span class="w-2.5"></span>`}${fileMark(k)}<span class="truncate">${n}</span></div>`).join("")}
  </div>`;

/** Files filling the card: its top row, then `side` (finderSidebar, fileTree, or nothing), then `head` over `body`. */
const filesPlace = ({
  top = filesTop(),
  side = finderSidebar(),
  head = "",
  body = "",
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${top}
    <div class="flex min-h-0 flex-1">
      ${side}
      <div class="relative flex min-w-0 flex-1 flex-col">${head}<div class="relative min-h-0 flex-1 overflow-hidden">${body}</div></div>
    </div>
  </div>`;

/** The Finder as Files opens it on the Instrument folder, in list view. */
const finder = ({ pick = -1 } = {}) =>
  filesPlace({
    top: filesTop({ crumbs: ["studio26", "Instrument"] }),
    side: finderSidebar({ on: "Instrument" }),
    head: finderHeader({ title: "Instrument", views: finderViews("list") }),
    body: finderListView(
      FINDER_FILES.map(([k, n], i) => [
        k,
        n,
        `Oct ${8 - (i % 5)}, 2026 at ${9 + (i % 4)}:${10 + i * 5} AM`,
        k === "folder" ? "--" : `${12 + i * 7} KB`,
        {
          folder: "Folder",
          html: "text/html",
          md: "text/markdown",
          csv: "text/csv",
        }[k],
      ]),
      { pick },
    ),
  });

// ---- floating ------------------------------------------------------------------

/** The small view: a chat popped out over whatever place is up, docked like the draft (420x560, 20px from the right, flush to the window's foot), its tiles over its reply box. Its head is the chat's own: title and caret, what is in flight (`working`, or `tasks` once they finish), minimize, expand and ×. `peek` is the index of the tile peeked at, drawn in a card over the conversation. */
const smallChat = ({
  title = PRICING_TITLE,
  tabs = [],
  peek = -1,
  body = pricing(2),
  working = "",
  tasks = false,
  right = 20,
  w = 420,
  h = 560,
  reply = {},
} = {}) => `
  <div class="absolute bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl ring-1 ring-black/5" style="right:${right}px;width:${w}px;height:${h}px">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <i class="ph ph-chats text-[16px] text-muted-foreground"></i>
      <span class="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-semibold"><span class="truncate">${title}</span><i class="ph ph-caret-down shrink-0 text-[12px] font-normal text-muted-foreground"></i></span>
      ${working ? workLine(working, { compact: true }) : tasks ? tasksMark : ""}
      <span class="flex items-center gap-0.5 text-muted-foreground">${["minus", "arrows-out-simple", "x"].map((i) => `<span class="grid size-7 place-items-center"><i class="ph ph-${i} text-[16px]"></i></span>`).join("")}</span>
    </div>
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pt-3 text-[13px]">${body}</div>
      <div class="shrink-0 p-2.5">${tabs.length ? chatTiles(tabs, peek) : ""}${replyBox(reply)}</div>
      ${peek >= 0 ? chatPeek(tabs[peek]) : ""}
    </div>
  </div>`;

/** The peek: a small view's tile open in a card over its conversation, from under the head to just over the tiles, its row ending in Expand and ×. */
const chatPeek = (t, { bottom = 180 } = {}) => `
  <div class="absolute inset-x-2 top-2 z-10 flex flex-col overflow-hidden rounded-xl bg-background shadow-xl ring-1 ring-gray-300" style="bottom:${bottom}px">
    ${locRow(t, { close: true, expand: true })}
    <div class="relative min-h-0 flex-1 overflow-hidden">${page(t)}</div>
  </div>`;

/** A minimized chat: a 300px dark bar on the bottom edge. */
const miniBar = ({
  title = PRICING_TITLE,
  working = false,
  right = 12,
} = {}) => `
  <div class="absolute bottom-0 z-40 flex h-10 w-[300px] items-center gap-2 rounded-t-xl bg-gray-900 px-3 text-[12px] text-white" style="right:${right}px">
    ${working ? pulse : `<i class="ph ph-chats-circle"></i>`}<span class="min-w-0 flex-1 truncate">${title}</span><i class="ph ph-caret-up"></i><i class="ph ph-x"></i>
  </div>`;

/** A popover menu of [icon, label] rows, placed absolutely. Pass "rule" for a divider. */
const menu = (items, { left, top, w = 240 } = {}) => `
  <div class="absolute z-50 rounded-xl border border-border bg-card p-1 shadow-xl" style="left:${left}px;top:${top}px;width:${w}px">
    ${items.map((it) => (it === "rule" ? `<div class="my-1 h-px bg-border"></div>` : `<div class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]">${it[0]}<span class="flex-1">${it[1]}</span>${it[2] ? `<span class="text-[11px] text-muted-foreground">${it[2]}</span>` : ""}</div>`)).join("")}
  </div>`;

/** A sheet over the window with the ground dimmed. */
const sheet = (inner, { w = 760, h = 620 } = {}) => `
  <div class="absolute inset-0 z-40 grid place-items-center bg-black/30">
    <div class="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" style="width:${w}px;height:${h}px">${inner}</div>
  </div>`;

// ---- composing ------------------------------------------------------------------
// Measured off the documents fixture (2026-10-04) at 1240x840: the draft is a compose
// window 600 wide, 20 from the window's right edge and flush to its foot, with a 48px
// head. The reply box opens up into a row over the words while the caret is in it.

/** The model control: the provider's mark and the model's name, muted, with a caret. `warn` is the amber unavailable state. */
const modelTrigger = (
  name,
  { mark = "instrumentglyph", warn = false } = {},
) => `
  <span class="flex h-6 min-w-0 items-center gap-2 rounded-lg px-1.5 text-[12px] font-medium ${warn ? "text-warning-700" : "text-gray-400"}">${warn ? `<i class="ph ph-warning text-[16px]"></i>` : brand(mark)}<span class="truncate">${name}</span><i class="ph ph-caret-down text-[11px]"></i></span>`;

/** The amber bar that leads the reply box, and the draft under its head, when the chosen model has a problem, with the way to fix it (`action`) at its end. */
const modelProblem = (text, { action = "Add a provider" } = {}) =>
  `<span class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-yellow-50 py-1 pr-1 pl-2.5 text-[12px] text-yellow-900 ring-1 ring-yellow-200"><i class="ph ph-warning text-[16px] text-yellow-700"></i><span class="min-w-0 flex-1 truncate">${text}</span>${action ? `<span class="flex h-6 shrink-0 items-center rounded-md bg-white px-2 font-medium text-foreground shadow-xs ring-1 ring-border">${action}</span>` : ""}</span>`;

/** The draft: a compose window docked at the window's bottom right. Pass it as appWindow's `over`. `model` is the head's model control; `over` draws on top of the compose window (a picker hanging from its head). */
const composeWin = ({
  title = "New chat",
  model = modelTrigger("Auto"),
  words = "",
  ph = "What do you need?",
  h = 600,
  over = "",
} = {}) => `
  <div class="absolute bottom-0 z-40 flex w-[600px] flex-col rounded-t-2xl border border-b-0 border-border bg-card shadow-2xl" style="right:20px;height:${h}px">
    <div class="flex h-12 shrink-0 items-center gap-1.5 px-3">
      <span class="flex h-7 items-center px-1.5 text-[13px] font-medium">${title}</span>
      <span class="flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground"><i class="ph ph-plus text-[12px]"></i>Topic</span>
      <div class="ml-auto flex min-w-0 items-center gap-2 pl-2">${model}<span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span></div>
      <div class="ml-1 flex shrink-0 items-center gap-0.5 border-l border-border pl-2 text-muted-foreground">${["minus", "arrows-out-simple", "x"].map((i) => `<span class="grid size-7 place-items-center"><i class="ph ph-${i} text-[16px]"></i></span>`).join("")}</div>
    </div>
    <div class="min-h-24 flex-1 px-4 pt-1 text-[15px] leading-6 ${words ? "" : "text-gray-400"}">${words || ph}</div>
    <div class="mx-2 flex shrink-0 flex-col gap-4 rounded-t-xl bg-gray-200 p-4">
      <div class="grid grid-cols-3 gap-4">${[
        ["globe", "Browser"],
        ["desktop", "This Mac"],
        ["squares-four", "Apps"],
      ]
        .map(
          ([i, l]) =>
            `<div class="flex flex-col items-center gap-2"><div class="grid h-28 w-full place-items-center rounded-xl bg-card ring-1 ring-border"><i class="ph ph-${i} text-[28px] text-muted-foreground"></i></div><span class="text-[13px] font-medium">${l}</span></div>`,
        )
        .join("")}</div>
      <div class="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-[12px] text-muted-foreground"><span class="flex-1">Drop files here</span><span class="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2.5 text-foreground ring-1 ring-border"><i class="ph ph-paperclip"></i>Attach files</span><span class="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2.5 text-foreground ring-1 ring-border"><i class="ph ph-folder"></i>Add a folder</span></div>
    </div>
    ${over}
  </div>`;

/** The reply box opened up: `extras` (a model notice, chips) over the words, then the plus and the arrow. Pass it as thread's `replyEl`. */
const replyBoxOpen = ({
  extras = "",
  text = "",
  ph = "Talk to Instrument",
} = {}) => `
  <div class="flex flex-col gap-1.5 rounded-[22px] bg-white p-1.5 shadow-sm">
    ${extras ? `<div class="flex items-center gap-1.5 px-0.5">${extras}</div>` : ""}
    <div class="flex items-center gap-2">
      ${plusButton}
      <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
      <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>
    </div>
  </div>`;

/** The reply box's plus menu as built, as wide as the reply box (`w`). `model` is the model row: "Choose a model" with none chosen, else "Model · <name>". */
const plusMenu = ({ left, top, w = 326, model = "Choose a model" } = {}) =>
  menu(
    [
      [`<i class="ph ph-globe text-[15px]"></i>`, "Browser"],
      [`<i class="ph ph-desktop text-[15px]"></i>`, "This Mac"],
      "rule",
      [`<i class="ph ph-paperclip text-[15px]"></i>`, "Attach files"],
      [`<i class="ph ph-folder text-[15px]"></i>`, "Add a folder"],
      "rule",
      [
        `<i class="ph ph-shapes text-[15px]"></i>`,
        "Apps",
        `<i class="ph ph-caret-right"></i>`,
      ],
      [
        `<i class="ph ph-cube text-[15px]"></i>`,
        "Skills",
        `<i class="ph ph-caret-right"></i>`,
      ],
      [`<i class="ph ph-cpu text-[15px]"></i>`, model],
    ],
    { left, top, w },
  );

// ---- model picker ----------------------------------------------------------------

/** The picker's size as built: PANEL_WIDTH and PANEL_HEIGHT in model-picker.tsx. */
const PICKER_W = 680;
const PICKER_H = 520;

/** The connections in the picker's rail, in the order Settings lists them. */
const PICKER_CONNS = [
  { k: "instrument", name: "Instrument", mark: "instrumentglyph" },
  { k: "chatgpt", name: "ChatGPT plan", mark: "openai" },
  { k: "anthropic", name: "Anthropic", mark: "anthropic" },
  { k: "openrouter", name: "OpenRouter", mark: "openrouter" },
];

/** The chosen row: the pressed tint and a check at its end. */
const PICKED = "bg-accent text-accent-foreground";
const pickedCheck = `<i class="ph ph-check text-[16px]"></i>`;

/** The picker's popover placed in a window frame, `left`/`top` in the window's pixels. */
const pickerPop = (inner, { left = 0, top = 0 } = {}) => `
  <div class="absolute z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-xl" style="left:${left}px;top:${top}px;width:${PICKER_W}px;height:${PICKER_H}px">${inner}</div>`;

/** The picker alone, filling a PICKER_W x PICKER_H frame, for a frame about what is inside it. */
const pickerCrop = (inner) =>
  `<div class="flex h-full flex-col bg-popover text-foreground [color-scheme:light]">${inner}</div>`;

const pickerSearch = (q = "") => `
  <div class="shrink-0 border-b border-border p-2">
    <div class="flex h-8 items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 text-[14px]">
      <i class="ph ph-magnifying-glass text-[15px] text-muted-foreground"></i>
      <span class="${q ? "" : "text-muted-foreground"}">${q || "Search models"}</span>${q ? `<span class="-ml-1.5 h-4 w-px bg-foreground"></span>` : ""}
    </div>
  </div>`;

/** The rail: `open` is lit, `held` (the connection with the chosen model) carries a small check, `mark` gets the click. */
const pickerRail = (open, { held = "", mark = "" } = {}) => `
  <div class="flex w-50 shrink-0 flex-col gap-0.5 border-r border-border bg-muted/40 p-2">
    ${PICKER_CONNS.map((c) => {
      const it = `<div class="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-[14px] ${open === c.k ? "bg-black/[0.06] font-medium" : ""}">${brand(c.mark)}<span class="min-w-0 flex-1 truncate">${c.name}</span>${held === c.k ? `<i class="ph ph-check text-[14px] text-muted-foreground"></i>` : ""}</div>`;
      return mark === c.k ? clickable(it) : it;
    }).join("")}
    <div class="flex-1"></div>
    <div class="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-[14px] text-muted-foreground"><i class="ph ph-plus text-[16px]"></i>Add a provider</div>
  </div>`;

/** A group label in the list (a maker under OpenRouter, Older versions). */
const pickerHead = (t, mark = "") =>
  `<div class="flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[12px] font-medium text-muted-foreground">${mark ? brand(mark, "size-3.5") : ""}${t}</div>`;

/** A model row as ModelRow draws it: the maker's mark, the name, an optional line under it, the check when chosen. */
const pickerRow = (name, { mark = "", sub = "", on = false } = {}) => `
  <div class="flex items-center gap-2.5 rounded-md px-2.5 ${sub ? "py-1.5" : "min-h-9"} ${on ? PICKED : ""}">
    ${mark ? brand(mark) : ""}
    <span class="flex min-w-0 flex-1 flex-col"><span class="truncate text-[14px] ${on ? "font-medium" : ""}">${name}</span>${sub ? `<span class="truncate text-[12px] ${on ? "opacity-80" : "text-muted-foreground"}">${sub}</span>` : ""}</span>
    ${on ? pickedCheck : ""}
  </div>`;

/** Auto as AutoRow draws it at the head of a longer Instrument list, with the rule under it. */
const pickerAutoRow = ({ on = false } = {}) => `
  <div class="flex min-h-9 items-center gap-2.5 rounded-md px-2.5 ${on ? PICKED : ""}">
    ${brand("instrumentglyph")}
    <span class="flex min-w-0 flex-1 items-baseline gap-2"><span class="text-[14px] ${on ? "font-medium" : ""}">Auto</span><span class="text-[12px] font-medium text-brand-700">Recommended</span><span class="truncate text-[12px] ${on ? "opacity-80" : "text-muted-foreground"}">Included with your subscription</span></span>
    ${on ? pickedCheck : ""}
  </div>
  <div class="mx-2.5 my-2 h-px bg-border"></div>`;

/** Auto as AutoOnly draws it when it is all Instrument offers: centered, with its one button. */
const pickerAutoOnly = ({ on = false } = {}) => `
  <div class="flex flex-col items-center gap-3 px-6 pt-16 pb-10 text-center">
    ${brand("instrumentglyph", "size-9")}
    <div class="flex flex-col items-center gap-1">
      <span class="flex items-center gap-2 text-[16px] font-medium">Auto<span class="text-[12px] font-medium text-brand-700">Recommended</span></span>
      <span class="text-[14px] text-muted-foreground">Included with your subscription</span>
    </div>
    ${on ? `<span class="mt-1 flex h-8 items-center gap-1.5 px-3 text-[14px] font-medium"><i class="ph ph-check text-[16px]"></i>In use</span>` : `<span class="mt-1 flex h-8 items-center rounded-lg bg-brand-600 px-3 text-[14px] font-medium text-white">Use Auto</span>`}
  </div>`;

/** The whole panel: search over the rail and the open connection's list. */
const modelPicker = ({
  open = "instrument",
  held = "",
  list = "",
  q = "",
  mark = "",
} = {}) =>
  `${pickerSearch(q)}<div class="flex min-h-0 flex-1">${pickerRail(q ? "" : open, { held, mark })}<div class="min-w-0 flex-1 overflow-hidden p-2">${list}</div></div>`;

// ---- onboarding ------------------------------------------------------------------

/** The app mark: the app icon from BRAND_URI, clipped to the macOS rounded square. */
const brandMark = (cls = "size-20") =>
  `<img src="${BRAND_URI.instrument}" class="block ${cls} shrink-0 rounded-[22%] shadow-md" alt="">`;

/** Onboarding's own 480x600 window: a gradient, the lights, centered content and an optional pinned footer. `tone` is brand (welcome, success) or subtle (the other steps). */
const onboardWin = ({
  body = "",
  foot = "",
  tone = "brand",
  over = "",
} = {}) => `
  <div class="relative flex h-full flex-col overflow-hidden text-foreground [color-scheme:light]" style="background:${tone === "brand" ? "linear-gradient(180deg,#c5d5d0,#fcfbf8)" : "linear-gradient(180deg,#e3ebe6,#fcfbf8 30%)"}">
    <div class="flex h-10 shrink-0 items-center">${trafficLights}</div>
    <div class="flex min-h-0 flex-1 flex-col items-center px-6 pt-4 pb-6">${body}</div>
    ${foot ? `<div class="shrink-0 px-6 pb-6 text-center">${foot}</div>` : ""}
    ${over}
  </div>`;

/** The sign-in step as built: mark, serif heading, Google and ChatGPT. */
const onboardLogin = () => `
  <div class="flex w-full flex-col items-center gap-10">
    <div class="flex flex-col items-center gap-6">
      ${brandMark()}
      <h1 class="font-serif text-3xl font-medium tracking-tight">Log in to Instrument</h1>
      <p class="-mt-3 text-sm text-foreground/80">A guided AI workspace for ambitious work</p>
    </div>
    <div class="flex w-full max-w-xs flex-col items-center gap-4">
      <p class="text-xs font-medium text-brand-600">Create an account to enjoy free AI usage</p>
      <div class="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium shadow-sm">${brand("google")}Continue with Google</div>
      <div class="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium"><i class="ph ph-open-ai-logo text-[16px]"></i>Continue with ChatGPT</div>
      <p class="text-center text-xs text-foreground/60">Instrument can run on the ChatGPT Plus or Pro plan you already pay for.</p>
    </div>
  </div>`;
