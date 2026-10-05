// ---- the window kit ------------------------------------------------------------
// The Studio window, measured off a 1240x840 window on the documents fixture
// (2026-10-01) and redrawn at 1280x800 in the light theme. The bar (40) and the rail
// (76) sit on the gray ground; everything else is one rounded card inset 8px from the
// right and bottom. Chat is the inbox column (320) beside a thread or the empty state;
// a chat's tiles stand in a row over its reply box, and its pane sits flush beside
// it. Tiles, pane and peek re-measured off the documents fixture (2026-10-05). Window tabs live
// in the bar. Onboarding is its own 480x600 window. build.mjs pastes this whole file,
// after brands.js, into the wireframe template's kit section.

const brand = (key, cls = "size-4") =>
  `<img src="${BRAND_URI[key]}" class="${cls} shrink-0" alt="">`;

/** A letter mark for a site with no brand mark in BRAND_URI. Pass finished classes. */
const letterMark = (letter, cls, size = "size-4 text-[9px]") =>
  `<span class="grid ${size} shrink-0 place-items-center rounded-[4px] font-bold text-white ${cls}">${letter}</span>`;

// Sites the Lisbon thread's task opens. Invented pages, real hosts.
const SITES = {
  tap: {
    title: "Lisbon flights · TAP",
    host: "flytap.com",
    mark: (s) => letterMark("T", "bg-[#12a14b]", s),
  },
  booking: {
    title: "Hotels in Alfama · Booking.com",
    host: "booking.com",
    mark: (s) => letterMark("B", "bg-[#003580]", s),
  },
  cp: {
    title: "Lisboa → Sintra · CP",
    host: "cp.pt",
    mark: (s) => letterMark("CP", "bg-[#5a9e2f]", s),
  },
  wiki: {
    title: "Alfama · Wikipedia",
    host: "en.wikipedia.org",
    mark: (s) => brand("wikipedia", s ? s.split(" ")[0] : "size-4"),
  },
  maps: {
    title: "Belém to Alfama · Maps",
    host: "maps.google.com",
    mark: (s) => letterMark("M", "bg-[#34a853]", s),
  },
  notion: {
    title: "Trips · Notion",
    host: "notion.so",
    mark: (s) => brand("notion", s ? s.split(" ")[0] : "size-4"),
  },
};

// Files the Lisbon thread's task makes, and one from the user's folder.
const FILES = {
  itinerary: { title: "lisbon-itinerary.html", kind: "html" },
  costs: { title: "lisbon-costs.csv", kind: "csv" },
  packing: { title: "packing-list.md", kind: "md" },
  haiku: { title: "snow-haiku.md", kind: "md" },
};

/** The colored file-type marks the Finder draws. */
const fileMark = (kind, cls = "text-[13px]") =>
  ({
    html: `<span class="shrink-0 font-bold text-[#e8793a] ${cls}">#</span>`,
    md: `<span class="shrink-0 font-bold tracking-tighter text-[#3f9d52] ${cls}">M↓</span>`,
    csv: `<i class="ph ph-table shrink-0 text-[#2f8f5b] ${cls}"></i>`,
    pdf: `<i class="ph ph-file-pdf shrink-0 text-[#d14b3f] ${cls}"></i>`,
    folder: `<i class="ph ph-folder shrink-0 text-[#4a9ff5] ${cls}"></i>`,
  })[kind];

/** A tab is {site} or {file} or {newtab: true}; `agent` marks one the task is driving. */
const tabMark = (t, size) =>
  t.site
    ? SITES[t.site].mark(size)
    : t.file
      ? fileMark(FILES[t.file].kind)
      : `<i class="ph ph-magnifying-glass shrink-0 text-[14px]"></i>`;
const tabTitle = (t) =>
  t.site
    ? SITES[t.site].title
    : t.file
      ? FILES[t.file].title
      : t.title || "New tab";

// ---- window --------------------------------------------------------------------

const GROUND = "bg-[#e7e5e4]";
const trafficLights = `<div class="flex w-20 shrink-0 items-center gap-2 pl-3"><span class="size-3 rounded-full bg-[#ff5f57]"></span><span class="size-3 rounded-full bg-[#febc2e]"></span><span class="size-3 rounded-full bg-[#28c840]"></span></div>`;

/** A window tab in the bar. `t` is a tab ({site} | {file} | {newtab}) or {chats: true, title}. */
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

// The starter loads Phosphor's regular weight only, so a lit place keeps its outline
// icon and takes the brand color, where the app also swaps to the fill weight.
const RAIL = [
  ["chat", "Chat", "ph-chat-circle"],
  ["files", "Files", "ph-folder"],
  ["browser", "Browser", "ph-globe"],
  ["apps", "Apps", "ph-shapes"],
  ["discover", "Discover", "ph-map-trifold"],
];

/** The 76px app rail on the ground. `on` is chat | files | browser | apps | discover | "" (nothing lit). `user` draws the signed-in avatar in place of Settings. */
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
          <span class="flex h-6 items-center"><i class="ph ${icon} text-[24px]"></i></span>
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
    title: "Lisbon trip itinerary with ticket prices",
    preview:
      "It's going well: the task is checking current ticket prices and fares for the cost table.",
    unread: true,
    working: true,
    time: "9:41 AM",
  },
  {
    title: "Kitchen quotes from Alder St contractors",
    preview:
      "Three of the four replied. Harbor Build is the lowest, and the only one that includes permits.",
    starred: true,
    time: "Yesterday",
  },
  {
    title: "Season of the snow haiku in the Instrument",
    preview: "That was snow-haiku.md, in your Instrument folder.",
    time: "Mon",
  },
  {
    title: "Weekly grocery order",
    preview:
      "The cart is ready in Instacart; nothing is ordered until you say so.",
    time: "Sep 26",
  },
  {
    title: "demo-page HTML file in the Instrument folder",
    preview:
      "From its name alone, this is an HTML file called demo-page sitting in your Instrument folder.",
    time: "Sep 24",
  },
];

/** The view picker chip, the place marks, and search. `waiting` adds the amber needs-you dot. */
const inboxHead = ({ waiting = false } = {}) => `
  <div class="flex items-center gap-1 px-2 pt-2">
    <span class="flex h-10 items-center gap-1.5 rounded-xl bg-brand-50 pr-2 pl-2.5 text-[15px] font-semibold text-brand-800"><i class="ph ph-chats-circle text-[28px]"></i>Chats<i class="ph ph-caret-down text-[14px] text-brand-800/50"></i></span>
    ${waiting ? `<span class="grid size-10 place-items-center"><span class="size-2.5 rounded-full bg-warning-500"></span></span>` : ""}
    ${["ph-star", "ph-file-dashed", "ph-cards-three"].map((i) => `<span class="grid size-10 place-items-center rounded-xl text-muted-foreground"><i class="ph ${i} text-[28px]"></i></span>`).join("")}
  </div>
  <div class="px-2 pt-2 pb-1"><div class="flex h-7 items-center justify-center gap-1.5 rounded-full border border-border bg-card text-xs text-muted-foreground"><i class="ph ph-magnifying-glass text-[14px]"></i>Search</div></div>`;

/** An inbox row: hairline above, title (semibold when unread), two lines of peek, time at the bottom right. */
const row = (r, { on = false, first = false } = {}) => `
  <div class="relative flex flex-col gap-0.5 px-3 py-2.5 ${first ? "" : "border-t border-border"} ${on ? "bg-brand-50" : ""}">
    <div class="flex h-5 items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[13px] ${r.unread ? "font-semibold" : "text-foreground/90"}">${r.title}</span>
      ${r.starred ? `<i class="ph ph-star text-[14px] text-warning-500"></i>` : ""}
    </div>
    <div class="flex items-end gap-2">
      <span class="line-clamp-2 min-h-10 flex-1 text-[12px] leading-5 text-muted-foreground">${r.preview}</span>
      <span class="w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">${r.time || ""}</span>
    </div>
  </div>`;

/** The inbox column: head, search, rows. `on` is the open row's index (-1 for none). */
const inboxCol = ({ on = 0, w = 320, rows = ROWS, waiting = false } = {}) => `
  <div class="flex shrink-0 flex-col border-r border-border bg-background" style="width:${w}px">
    ${inboxHead({ waiting })}
    <div class="mt-1 flex flex-col">${rows.map((r, i) => row(r, { on: i === on, first: i === 0 })).join("")}</div>
  </div>`;

// ---- a chat --------------------------------------------------------------------

/** The chat header: inbox toggle, the title with its caret (which opens the chat's menu), then at the right the work in flight (`working`, from workLine) and pop-out. */
const threadHead = (title, { right = "", working = "" } = {}) => `
  <div class="flex shrink-0 items-center gap-2 bg-background p-3">
    <i class="ph ph-sidebar-simple px-1.5 text-[16px] text-muted-foreground"></i>
    <span class="flex min-w-0 items-center gap-1 text-sm font-medium"><span class="truncate">${title}</span><i class="ph ph-caret-down shrink-0 text-[12px] text-muted-foreground"></i></span>
    <span class="flex-1"></span>
    ${working}
    ${right || `<i class="ph ph-picture-in-picture px-1.5 text-[16px] text-muted-foreground"></i>`}
  </div>`;

const you = (text) =>
  `<div class="flex justify-end"><div class="max-w-[80%] rounded-2xl rounded-tr-md bg-[#bcdcd2] px-3.5 py-2 text-sm text-foreground">${text}</div></div>`;
const agent = (text) =>
  `<div class="max-w-[85%] rounded-2xl rounded-tl-md bg-card px-3.5 py-2 text-sm leading-[1.5]">${text}</div>`;

/** A file the agent linked, as the transcript's file card. */
const fileRow = (key) => `
  <div class="flex max-w-[85%] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-[13px]"><span class="grid size-8 shrink-0 place-items-center rounded-md border border-border">${fileMark(FILES[key].kind)}</span><span class="truncate">${FILES[key].title}</span></div>`;

/** A page the agent opened, as a thin row in the transcript. */
const pageRow = (site) => `
  <div class="flex max-w-[85%] items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px]">${SITES[site].mark()}<span class="truncate">${SITES[site].title}</span></div>`;

/** The work in flight, at a chat head's right while its tasks run: a spinner, the newest step in the shimmer's green and how many more (`more`), or with `compact` the spinner and the count. Pressed, it lists the chat's tasks. */
const workLine = (
  text = "Checking fares on flytap.com",
  { more = 0, compact = false } = {},
) => `
  <span class="flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-[12px]"><i class="ph ph-circle-notch shrink-0 animate-spin text-[13px] text-brand-600"></i>${compact ? `<span class="text-muted-foreground tabular-nums">${more + 1}</span>` : `<span class="truncate text-brand-600">${text}</span>${more ? `<span class="shrink-0 text-muted-foreground tabular-nums">+${more}</span>` : ""}`}<i class="ph ph-caret-down shrink-0 text-[11px] text-muted-foreground"></i></span>`;

const replyBox = ({ ph = "Talk to Instrument", text = "" } = {}) => `
  <div class="flex items-center gap-2 rounded-[22px] bg-white p-1.5 shadow-sm">
    <span class="grid size-7 shrink-0 place-items-center rounded-full"><i class="ph ph-plus text-[16px] text-muted-foreground"></i></span>
    <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
    <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>
  </div>`;

const LISBON_TITLE = "Lisbon trip itinerary with ticket prices";

/** The Lisbon chat's transcript. `stage` 1: running; 2: pages opened; 3: finished with files. */
const lisbon = (stage = 1) =>
  [
    you("Plan a trip to Lisbon"),
    agent(
      "I'll put together a Lisbon trip plan, assuming a first visit of about five days; say the word if the dates or length are different.",
    ),
    stage >= 2
      ? agent(
          "It's going well: the task is checking current ticket prices and fares for the cost table. I'll let you know when the itinerary page is ready.",
        )
      : "",
    stage >= 3
      ? agent(
          "The itinerary is ready: five days, Alfama base, Sintra on day three. Flights and the hotel come to about €1,140 for two.",
        )
      : "",
    stage >= 3 ? fileRow("itinerary") + fileRow("costs") : "",
  ]
    .filter(Boolean)
    .join("");

/** A chat column: header (with the work in flight while `working` names a step), the centered transcript, then its tiles (`tiles`, from chatTiles) over the reply box. */
const thread = ({
  title = LISBON_TITLE,
  body = lisbon(2),
  working = "",
  tiles = "",
  head = "",
  foot = "",
  reply = {},
  replyEl = "",
} = {}) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${head || threadHead(title, { working: working ? workLine(working) : "" })}
    <div class="min-h-0 flex-1 overflow-hidden"><div class="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4">${body}</div></div>
    <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">${tiles}${foot}${replyEl || replyBox(reply)}</div>
  </div>`;

// ---- tabs, the pane, pages -------------------------------------------------------

const pulse = `<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-500"></span>`;

/** The location row: back, forward, and the omnibar holding crumbs or an address. `close` ends it with Expand (a file's, or a peek's) and the × that puts the view away. */
const locRow = (t, { close = false, expand = false } = {}) => `
  <div class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-background px-2 text-muted-foreground">
    <i class="ph ph-caret-left px-1 text-[14px]"></i><i class="ph ph-caret-right text-[14px] text-gray-300"></i>
    <div class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12px]">
      ${
        !t || t.newtab
          ? `<span class="w-full text-center text-gray-400">Search, open a file, or ask Instrument</span>`
          : t.site
            ? `${SITES[t.site].mark()}<span class="truncate text-foreground">${SITES[t.site].host}</span>`
            : `${fileMark("folder")}<span>Instrument</span><i class="ph ph-caret-right text-[10px]"></i><span class="truncate text-foreground">${FILES[t.file].title}</span>`
      }
    </div>
    ${close && (expand || t?.file) ? `<i class="ph ph-arrows-out-simple px-1 text-[15px]"></i>` : ""}
    ${close ? `<i class="ph ph-x px-1 text-[15px]"></i>` : ""}
  </div>`;

/** One of a chat's tiles: its picture filling a 4:3 box from the top, over its mark and name. `on` rings the one shown large; a page an agent drives has its name in the brand color (the app's shimmer). */
const chatTile = (t, { on = false } = {}) => `
  <div class="flex w-24 shrink-0 flex-col gap-1.5">
    <div class="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-card shadow-xs ${on ? "ring-2 ring-foreground/70" : "ring-1 ring-border/70"}"><div class="absolute top-0 left-0 origin-top-left scale-[0.25]" style="width:400%;height:400%">${page(t)}</div></div>
    <span class="flex min-w-0 items-center gap-1 px-0.5 text-[11px] leading-4 text-muted-foreground"><span class="grid size-3 shrink-0 place-items-center overflow-hidden text-[9px]">${tabMark(t, "size-3 text-[6px]")}</span><span class="truncate ${t.agent ? "text-brand-600" : ""}">${tabTitle(t)}</span></span>
  </div>`;

/** A chat's tiles in a row over its reply box (thread's `tiles`): one per thing it holds, oldest first, then New. `active` is the one shown large, -1 for none; past the column's width the row scrolls sideways. */
const chatTiles = (tabs, active = -1) => `
  <div class="mb-2 flex items-start gap-2 overflow-hidden p-0.5">
    ${tabs.map((t, i) => chatTile(t, { on: i === active })).join("")}
    <div class="flex h-18 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-medium text-muted-foreground"><i class="ph ph-plus text-[16px]"></i>New</div>
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
  tap: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center gap-2 bg-[#12a14b] px-4 text-[12px] font-bold text-white">TAP AIR PORTUGAL<span class="flex-1"></span><span class="font-normal">EN · €</span></div>
      <div class="p-4">
        <div class="text-[15px] font-semibold">New York (JFK) → Lisbon (LIS)</div>
        <div class="mt-1 text-[11px] text-muted-foreground">Thu 15 Oct → Tue 20 Oct · 2 adults · Economy</div>
        ${[
          ["TP 210", "7:40 PM → 7:25 AM", "€412"],
          ["TP 202", "10:10 PM → 9:55 AM", "€389"],
          ["TP 208", "5:55 PM → 5:45 AM", "€455"],
        ]
          .map(
            ([n, t, p], i) =>
              `<div class="mt-2.5 flex items-center gap-3 rounded-lg border ${i === 1 ? "border-[#12a14b]" : "border-border"} p-2.5 text-[12px]"><span class="w-12 font-medium">${n}</span><span class="flex-1">${t}</span><span class="font-semibold">${p}</span></div>`,
          )
          .join("")}
      </div>
    </div>`,
  booking: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center bg-[#003580] px-4 text-[13px] font-bold text-white">Booking.com</div>
      <div class="p-4">
        <div class="text-[14px] font-semibold">Alfama, Lisbon: 38 properties</div>
        ${[
          ["Memmo Alfama", "9.1", "€212"],
          ["Palácio Belmonte", "9.4", "€340"],
          ["Solar do Castelo", "8.9", "€188"],
        ]
          .map(
            ([n, s, p]) =>
              `<div class="mt-2.5 flex gap-3 rounded-lg border border-border p-2"><div class="size-12 shrink-0 rounded bg-[#d9e4f2]"></div><div class="min-w-0 flex-1 text-[12px]"><div class="font-semibold text-[#006ce4]">${n}</div><div class="mt-1 text-[11px] text-muted-foreground">${s} · per night</div></div><span class="text-[12px] font-semibold">${p}</span></div>`,
          )
          .join("")}
      </div>
    </div>`,
  cp: () => `
    <div class="h-full bg-white">
      <div class="flex h-10 items-center gap-2 border-b border-border px-4 text-[13px] font-bold text-[#5a9e2f]">CP · Comboios de Portugal</div>
      <div class="p-4 text-[12px]"><div class="text-[14px] font-semibold">Lisboa Rossio → Sintra</div><div class="mt-3 space-y-2">${["09:11", "09:41", "10:11", "10:41"].map((t) => `<div class="flex justify-between border-b border-border pb-1.5"><span>${t}</span><span class="text-muted-foreground">40 min</span><span>€2.40</span></div>`).join("")}</div></div>
    </div>`,
  wiki: () =>
    `<div class="h-full bg-white p-5"><div class="font-serif text-[20px]">Alfama</div><div class="mt-1 border-b border-border pb-1 text-[10px] text-muted-foreground">From Wikipedia, the free encyclopedia</div><div class="mt-3 space-y-2">${bars2("100%", "96%", "88%", "100%", "62%")}</div><div class="mt-4 space-y-2">${bars2("100%", "91%", "70%")}</div></div>`,
  maps: () =>
    `<div class="relative h-full bg-[#e8eef0]"><div class="absolute inset-0 bg-[repeating-linear-gradient(35deg,transparent_0_38px,#fff_38px_42px)]"></div><div class="absolute top-4 left-4 rounded-lg bg-white px-3 py-2 text-[12px] shadow">Belém → Alfama · 28 min by tram</div></div>`,
  notion: () =>
    `<div class="h-full bg-white p-6"><div class="text-[22px] font-bold">Trips</div><div class="mt-4 space-y-2">${bars2("60%", "44%", "52%")}</div></div>`,
  itinerary: () => `
    <div class="h-full bg-white p-5">
      <div class="text-[11px] font-medium tracking-wide text-[#e8793a] uppercase">Lisbon · 15–20 Oct</div>
      <div class="mt-1 text-[18px] font-semibold">Five days in Lisbon</div>
      ${[
        "Day 1 · Alfama and the castle",
        "Day 2 · Belém",
        "Day 3 · Sintra by train",
        "Day 4 · LX Factory",
        "Day 5 · Chiado",
      ]
        .map(
          (d) =>
            `<div class="mt-3 text-[12px] font-medium">${d}</div><div class="mt-1.5 space-y-1.5">${bars2("92%", "64%")}</div>`,
        )
        .join("")}
    </div>`,
  costs: () => `
    <div class="h-full bg-white p-3 font-mono text-[11px]">
      ${[
        ["item", "each", "total"],
        ["Flights TP 202 ×2", "€389", "€778"],
        ["Memmo Alfama ×5", "€212", "€1,060"],
        ["Sintra train ×4", "€2.40", "€9.60"],
        ["Tram 28 day pass ×2", "€6.80", "€13.60"],
      ]
        .map(
          (r, i) =>
            `<div class="grid grid-cols-[1fr_60px_70px] border-b border-border py-1.5 ${i ? "" : "font-semibold"}">${r.map((c) => `<span>${c}</span>`).join("")}</div>`,
        )
        .join("")}
    </div>`,
  packing: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Packing list</div><div class="mt-3 space-y-2">${bars2("40%", "52%", "36%", "48%")}</div></div>`,
  haiku: () =>
    `<div class="h-full bg-white p-5"><div class="text-[18px] font-semibold">Snow haiku</div><div class="mt-3 space-y-2">${bars2("50%", "62%", "44%")}</div></div>`,
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

/** Files, Browser, an app or a skill: the place fills the card, under its location row (none on Apps and Discover). Its tabs are the window's, in the bar. */
const placeCard = ({ tab, body, loc = true }) => `
  <div class="flex min-w-0 flex-1 flex-col">
    ${loc ? locRow(tab) : ""}
    <div class="relative min-h-0 flex-1 overflow-hidden">${body ?? page(tab)}</div>
  </div>`;

const FINDER_FILES = [
  ["folder", "ai-spend"],
  ["html", "comparison-index.html"],
  ["md", "claude-usage-report.md"],
  ["folder", "cat-word-doc"],
  ["html", "lisbon-itinerary.html"],
  ["csv", "lisbon-costs.csv"],
  ["md", "packing-list.md"],
  ["md", "snow-haiku.md"],
  ["html", "demo-page.html"],
];

/** The Finder, Files' first tab. */
const finder = ({ pick = -1 } = {}) => `
  <div class="flex h-full">
    <div class="w-[180px] shrink-0 border-r border-border p-2 text-[12px]">
      <div class="flex items-center gap-2 px-2 py-1.5"><i class="ph ph-clock-counter-clockwise"></i>Recents</div>
      <div class="px-2 pt-3 pb-1 text-[11px] text-muted-foreground">Favorites</div>
      ${["Instrument", "Home", "Desktop", "Documents", "Downloads"].map((n, i) => `<div class="flex items-center gap-2 rounded-md px-2 py-1.5 ${i === 0 ? "bg-black/[0.06]" : ""}">${fileMark("folder")}${n}</div>`).join("")}
      <div class="px-2 pt-3 pb-1 text-[11px] text-muted-foreground">Locations</div>
      <div class="flex items-center gap-2 px-2 py-1.5"><i class="ph ph-hard-drive"></i>Macintosh HD</div>
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex h-10 items-center gap-2 border-b border-border px-3 text-[13px] font-medium">Instrument<span class="flex-1"></span><span class="flex h-7 w-40 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] font-normal text-gray-400"><i class="ph ph-magnifying-glass"></i>Search</span></div>
      <div class="w-[260px] border-r border-border p-1.5 text-[12px]">${FINDER_FILES.map(([k, n], i) => `<div class="flex items-center gap-2 rounded-md px-2 py-1.5 ${i === pick ? "bg-[#d6e6fb]" : ""}">${fileMark(k)}<span class="truncate">${n}</span></div>`).join("")}</div>
    </div>
  </div>`;

// ---- floating ------------------------------------------------------------------

/** The small view: a thread floating over whatever place is up (420x560, bottom right), its tiles over its reply box. `peek` is the index of the tile peeked at, drawn in a card over the conversation. */
const smallChat = ({
  title = LISBON_TITLE,
  tabs = [],
  peek = -1,
  body = lisbon(2),
  working = "",
  right = 12,
  bottom = 12,
  w = 420,
  h = 560,
  reply = {},
} = {}) => `
  <div class="absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" style="right:${right}px;bottom:${bottom}px;width:${w}px;height:${h}px">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <i class="ph ph-chats-circle text-[15px]"></i>
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium">${title}</span>
      ${working ? workLine(working, { compact: true }) : ""}
      <i class="ph ph-minus text-[14px] text-muted-foreground"></i><i class="ph ph-arrows-out-simple text-[14px] text-muted-foreground"></i><i class="ph ph-x text-[14px] text-muted-foreground"></i>
    </div>
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pt-3">${body}</div>
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
  title = LISBON_TITLE,
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

/** The amber notice that leads the open reply box when the chosen model has a problem; it opens the picker. */
const modelProblem = (text) =>
  `<span class="flex h-7 min-w-0 items-center gap-1.5 rounded-lg bg-warning-700/10 px-2 text-[12px] text-warning-700"><i class="ph ph-warning text-[14px]"></i><span class="truncate">${text}</span></span>`;

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
      <i class="ph ph-feather text-[16px] text-muted-foreground"></i>
      <span class="flex items-center gap-1 text-[14px] font-medium">${title}<i class="ph ph-caret-down text-[11px] text-muted-foreground"></i></span>
      <span class="ml-1 flex h-6 items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 text-[12px] text-muted-foreground"><i class="ph ph-plus text-[11px]"></i>Topic</span>
      <div class="ml-auto flex min-w-0 items-center gap-2 pl-2">${model}<span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span></div>
      <div class="ml-1 flex shrink-0 items-center gap-2.5 border-l border-border pl-3 text-muted-foreground"><i class="ph ph-minus text-[15px]"></i><i class="ph ph-arrows-out-simple text-[15px]"></i><i class="ph ph-x text-[15px]"></i></div>
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
    ${extras ? `<div class="flex items-center gap-1.5 px-1 pt-0.5">${extras}</div>` : ""}
    <div class="flex items-center gap-2">
      <span class="grid size-7 shrink-0 place-items-center rounded-full"><i class="ph ph-plus text-[16px] text-muted-foreground"></i></span>
      <span class="flex-1 truncate text-[13px] ${text ? "" : "text-gray-400"}">${text || ph}</span>
      <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600"><i class="ph ph-arrow-up text-[16px] text-white"></i></span>
    </div>
  </div>`;

/** The reply box's plus menu as built. `model` is the model row: "Choose a model" with none chosen, else "Model · <name>". */
const plusMenu = ({ left, top, model = "Choose a model" } = {}) =>
  menu(
    [
      [`<i class="ph ph-globe text-[15px]"></i>`, "Browser"],
      [`<i class="ph ph-desktop text-[15px]"></i>`, "This Mac"],
      "rule",
      [`<i class="ph ph-paperclip text-[15px]"></i>`, "Attach files"],
      [`<i class="ph ph-folder text-[15px]"></i>`, "Add a folder"],
      "rule",
      [
        `<i class="ph ph-squares-four text-[15px]"></i>`,
        "Apps",
        `<i class="ph ph-caret-right"></i>`,
      ],
      [`<i class="ph ph-cpu text-[15px]"></i>`, model],
    ],
    { left, top, w: 256 },
  );

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
      <div class="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium shadow-sm"><span class="text-[15px] font-bold text-[#4285f4]">G</span>Continue with Google</div>
      <div class="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium"><i class="ph ph-open-ai-logo text-[16px]"></i>Continue with ChatGPT</div>
      <p class="text-center text-xs text-foreground/60">Instrument can run on the ChatGPT Plus or Pro plan you already pay for.</p>
    </div>
  </div>`;
