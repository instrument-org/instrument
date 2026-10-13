// Outside the window: the Mac around Studio, and the web where people meet it first.
// Frames drawn with these run at DESKTOP size (a 14" MacBook Pro's default 1512x982)
// rather than the window's 1280x800, so a state that uses them sets `w` and `h`.

const DESKTOP = { w: 1512, h: 982 };

/** A true-size frame scaled into place on the desktop: the 1280x800 window, onboarding, a browser. */
const placed = (
  html,
  { left, top, w = 1280, h = 800, scale = 0.8, shadow = true } = {},
) => `
  <div class="absolute overflow-hidden rounded-xl ${shadow ? "shadow-2xl ring-1 ring-black/15" : ""}" style="left:${left}px;top:${top}px;width:${w * scale}px;height:${h * scale}px">
    <div class="absolute top-0 left-0 origin-top-left" style="width:${w}px;height:${h}px;transform:scale(${scale})">${html}</div>
  </div>`;

/** The Instrument mark as it sits in the menu bar: a small monochrome two-bar glyph. */
const menuBarGlyph = `<span class="flex w-3.5 flex-col gap-[3px]"><span class="block h-[3px] rounded-full bg-current"></span><span class="block h-[3px] rounded-full bg-current"></span></span>`;

/** The 24px menu bar. `app` is the frontmost app's bold name; `extra` puts Instrument's glyph among the status items, `lit` draws it pressed. */
const menuBar = ({
  app = "Instrument",
  menus = ["File", "Edit", "View", "Window", "Help"],
  extra = false,
  lit = false,
  time = "Fri Oct 2  9:41 AM",
} = {}) => `
  <div class="absolute inset-x-0 top-0 z-30 flex h-6 items-center gap-4 bg-white/45 px-4 text-[13px] text-black backdrop-blur-xl">
    <i class="ph ph-apple-logo text-[15px]"></i>
    <span class="font-semibold">${app}</span>
    ${menus.map((m) => `<span>${m}</span>`).join("")}
    <span class="flex-1"></span>
    ${extra ? `<span class="grid h-5 w-7 place-items-center rounded ${lit ? "bg-black/15" : ""}">${menuBarGlyph}</span>` : ""}
    <i class="ph ph-battery-high text-[16px]"></i><i class="ph ph-wifi-high text-[15px]"></i><i class="ph ph-magnifying-glass text-[14px]"></i><i class="ph ph-toggle-left text-[15px]"></i>
    <span class="tabular-nums">${time}</span>
  </div>`;

/** A panel hanging from Instrument's menu bar glyph, right-aligned under it. */
const menuBarPanel = (inner, { right = 236, w = 360, h = 420 } = {}) => `
  <div class="absolute top-7 z-40 flex flex-col overflow-hidden rounded-xl border border-black/10 bg-[#f6f5f3]/95 text-foreground shadow-2xl backdrop-blur-xl [color-scheme:light]" style="right:${right}px;width:${w}px;height:${h}px">${inner}</div>`;

/** Dock icons: a key names one below, anything else is drawn as a plain rounded square. */
const DOCK_APPS = {
  finder: `<span class="grid size-full place-items-center rounded-[22%] bg-linear-to-b from-[#6ec3f7] to-[#1e7ae0] text-white"><i class="ph ph-smiley text-[30px]"></i></span>`,
  safari: `<span class="grid size-full place-items-center rounded-[22%] bg-white text-[#1e88e5]"><i class="ph ph-compass text-[34px]"></i></span>`,
  chrome: `<span class="grid size-full place-items-center rounded-[22%] bg-white">${brand("googlechrome", "size-9")}</span>`,
  mail: `<span class="grid size-full place-items-center rounded-[22%] bg-linear-to-b from-[#5fb4ff] to-[#1a73e8] text-white"><i class="ph ph-envelope-simple text-[30px]"></i></span>`,
  notes: `<span class="grid size-full place-items-center rounded-[22%] bg-linear-to-b from-[#fde68a] to-[#fbbf24] text-[#7c5800]"><i class="ph ph-note-pencil text-[30px]"></i></span>`,
  obsidian: `<span class="grid size-full place-items-center rounded-[22%] bg-[#2b2540]">${brand("obsidian", "size-9")}</span>`,
  settings: `<span class="grid size-full place-items-center rounded-[22%] bg-linear-to-b from-[#a3a3a3] to-[#6b6b6b] text-white"><i class="ph ph-gear-six text-[32px]"></i></span>`,
};

/** The Dock along the bottom edge. `running` gets the dot; "instrument" draws the app mark. */
const dock = ({
  apps = [
    "finder",
    "safari",
    "mail",
    "notes",
    "obsidian",
    "instrument",
    "settings",
  ],
  running = ["finder", "instrument"],
  mark = {},
} = {}) => `
  <div class="absolute bottom-1.5 left-1/2 z-30 flex -translate-x-1/2 items-end gap-1.5 rounded-[22px] border border-white/40 bg-white/35 p-1.5 pb-2 backdrop-blur-xl">
    ${apps
      .map(
        (a) => `
      <div class="relative flex flex-col items-center">
        <span class="block size-14">${a === "instrument" ? brandMark("size-14") : DOCK_APPS[a] || `<span class="block size-full rounded-[22%] bg-gray-300"></span>`}</span>
        <span class="absolute -bottom-1.5 size-1 rounded-full ${running.includes(a) ? "bg-black/70" : ""}"></span>
        ${mark[a] || ""}
      </div>`,
      )
      .join("")}
  </div>`;

/** A notification banner, top right under the menu bar. */
const macNotification = ({
  title = "Instrument",
  body = "The pricing comparison is ready.",
  sub = "",
  time = "now",
  top = 34,
} = {}) => `
  <div class="absolute right-3 z-40 flex w-[356px] gap-3 rounded-2xl border border-black/10 bg-[#f6f5f3]/90 p-3 text-black shadow-xl backdrop-blur-xl [color-scheme:light]" style="top:${top}px">
    ${brandMark("size-9")}
    <div class="min-w-0 flex-1 text-[13px] leading-[1.35]">
      <div class="flex items-center gap-2"><span class="flex-1 truncate font-semibold">${title}</span><span class="text-[11px] text-black/45">${time}</span></div>
      ${sub ? `<div class="truncate font-medium">${sub}</div>` : ""}
      <div class="line-clamp-2 text-black/75">${body}</div>
    </div>
  </div>`;

/** The desktop: wallpaper, menu bar, Dock, and whatever sits on it. `windows` and `over` are placed absolutely. */
const macDesktop = ({
  bar = menuBar(),
  windows = "",
  dock: dockHtml = dock(),
  over = "",
  wallpaper = "linear-gradient(160deg,#b9cfc8 0%,#8fb3ab 45%,#5f8f87 100%)",
} = {}) => `
  <div class="relative h-full overflow-hidden text-foreground [color-scheme:light]" style="background:${wallpaper}">
    ${bar}
    ${windows}
    ${dockHtml}
    ${over}
  </div>`;

/** A Finder window of the user's own (not Studio's Files place), true size w x h, for placing on the desktop. */
const finderWindow = ({
  title = "Documents",
  items = [
    ["folder", "Contracts"],
    ["folder", "SOC 2 audit"],
    ["pdf", "Ridgeline quote.pdf"],
    ["pdf", "Cobalt Assurance quote.pdf"],
    ["csv", "competitor-prices.csv"],
    ["md", "notes.md"],
  ],
  pick = -1,
} = {}) => `
  <div class="flex h-full flex-col bg-white text-[13px] [color-scheme:light]">
    <div class="flex h-12 shrink-0 items-center gap-3 border-b border-black/10 bg-[#f6f5f3] pr-3">
      ${trafficLights}
      <i class="ph ph-caret-left text-black/50"></i><i class="ph ph-caret-right text-black/25"></i>
      <span class="font-semibold">${title}</span><span class="flex-1"></span>
      <i class="ph ph-squares-four text-black/60"></i><i class="ph ph-magnifying-glass text-black/60"></i>
    </div>
    <div class="flex min-h-0 flex-1">
      <div class="w-44 shrink-0 bg-[#f6f5f3] p-2 text-[12px]">
        <div class="px-2 pt-1 pb-1 text-[11px] text-black/45">Favorites</div>
        ${["Recents", "Applications", "Desktop", "Documents", "Downloads"].map((n) => `<div class="flex items-center gap-2 rounded-md px-2 py-1 ${n === title ? "bg-black/[0.08]" : ""}">${fileMark("folder")}${n}</div>`).join("")}
      </div>
      <div class="grid flex-1 grid-cols-4 content-start gap-3 p-4">
        ${items.map(([k, n], i) => `<div class="flex flex-col items-center gap-1.5 rounded-md p-2 ${i === pick ? "bg-[#d6e6fb]" : ""}"><span class="text-[40px] leading-none">${fileMark(k, "text-[40px]")}</span><span class="line-clamp-2 text-center text-[11px]">${n}</span></div>`).join("")}
      </div>
    </div>
  </div>`;

/** A system context menu (the Mac's, not Studio's `menu`). Rows are labels, "rule", or [label, { sub, on }]. */
const contextMenu = (items, { left, top, w = 250 } = {}) => `
  <div class="absolute z-50 rounded-lg border border-black/10 bg-[#f2f1ef]/95 p-1 text-[13px] text-black shadow-xl backdrop-blur-xl" style="left:${left}px;top:${top}px;width:${w}px">
    ${items
      .map((it) => {
        if (it === "rule")
          return `<div class="mx-2 my-1 h-px bg-black/10"></div>`;
        const [label, o = {}] = Array.isArray(it) ? it : [it];
        return `<div class="flex items-center gap-2 rounded px-2 py-[3px] ${o.on ? "bg-[#2f7cf6] text-white" : ""}"><span class="flex-1">${label}</span>${o.sub ? `<i class="ph ph-caret-right text-[11px]"></i>` : ""}</div>`;
      })
      .join("")}
  </div>`;

/** Someone else's browser, true size, for the website and anything people see before installing. */
const browserWindow = ({
  url = "tryinstrument.com",
  tabs = ["Instrument"],
  body = "",
} = {}) => `
  <div class="flex h-full flex-col bg-white text-foreground [color-scheme:light]">
    <div class="flex h-10 shrink-0 items-end gap-1 bg-[#e8e6e3] pr-2">
      <div class="flex h-full items-center">${trafficLights}</div>
      ${tabs.map((t, i) => `<div class="flex h-8 w-52 items-center gap-2 rounded-t-lg px-3 text-[12px] ${i === 0 ? "bg-white" : "text-black/55"}">${i === 0 ? brandMark("size-4") : `<span class="size-4 rounded bg-black/10"></span>`}<span class="truncate">${t}</span></div>`).join("")}
    </div>
    <div class="flex h-10 shrink-0 items-center gap-3 border-b border-black/10 px-3 text-black/50">
      <i class="ph ph-arrow-left"></i><i class="ph ph-arrow-right"></i><i class="ph ph-arrow-clockwise"></i>
      <div class="flex h-7 flex-1 items-center gap-2 rounded-full bg-[#f1f0ee] px-3 text-[13px] text-black/80"><i class="ph ph-lock-simple text-[12px]"></i>${url}</div>
    </div>
    <div class="relative min-h-0 flex-1 overflow-hidden">${body}</div>
  </div>`;
